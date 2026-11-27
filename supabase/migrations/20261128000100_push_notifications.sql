-- Push notifications: "Olivier a ajouté 3 produits à Marché" on the other phones,
-- even with the app closed.
--
-- 1. Adding a shopping item puts it in a queue (private.push_queue).
-- 2. Every minute, pg_cron looks for groups (same author, same list) quiet for a
--    minute and calls the Edge Function `send-push`.
-- 3. The function takes the due groups (public.push_take_batch, service role only),
--    sends one Web Push per group to every subscribed phone except the author's,
--    and forgets subscriptions the push service says are gone.
-- The VAPID private key is in Supabase Vault (secret `vapid_private_key`), not here.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- subscriptions
-- One row per phone (browser) that turned notifications on.
create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Each member sees and manages only their own phones.
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member()))
  with check (user_id = (select auth.uid()) and (select private.is_member()));

revoke all on public.push_subscriptions from anon;

-- ---------------------------------------------------------------- queue
create table private.push_queue (
  id            bigint generated always as identity primary key,
  list_item_id  bigint not null,
  list_id       bigint not null,
  label         text not null,
  added_by      uuid,
  created_at    timestamptz not null default now()
);

alter table private.push_queue enable row level security;
revoke all on private.push_queue from public, anon, authenticated;

create function private.queue_list_item_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.done then
    insert into private.push_queue (list_item_id, list_id, label, added_by)
    values (new.id, new.list_id, new.label, new.added_by);
  end if;
  return new;
end;
$$;

revoke execute on function private.queue_list_item_push() from public, anon, authenticated;

create trigger list_items_queue_push after insert on public.list_items
  for each row execute function private.queue_list_item_push();

-- ---------------------------------------------------------------- batches
-- Takes the groups quiet for a minute out of the queue and returns what to send:
-- one notification per (author, list), with the subscriptions of the other members
-- (everyone when Claude added it). Items removed meanwhile are left out.
create function public.push_take_batch()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  with due as (
    select list_id, added_by
    from private.push_queue
    group by list_id, added_by
    having max(created_at) < now() - interval '50 seconds'
  ), taken as (
    delete from private.push_queue q
    using due
    where q.list_id = due.list_id and q.added_by is not distinct from due.added_by
    returning q.id, q.list_item_id, q.list_id, q.label, q.added_by
  ), groups as (
    select t.list_id, t.added_by, array_agg(t.label order by t.id) as labels
    from taken t
    where exists (select 1 from public.list_items i where i.id = t.list_item_id and not i.done)
    group by t.list_id, t.added_by
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'list', l.name,
    'list_slug', trim(both '-' from regexp_replace(extensions.unaccent(lower(l.name)), '[^a-z0-9]+', '-', 'g')),
    'list_id', l.id,
    'author', coalesce(m.display_name, 'Claude'),
    'labels', g.labels,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth))), '[]'::jsonb)
      from public.push_subscriptions s
      where g.added_by is null or s.user_id <> g.added_by)
  )), '[]'::jsonb)
  into result
  from groups g
  join public.lists l on l.id = g.list_id
  left join public.members m on m.user_id = g.added_by;

  return jsonb_build_object(
    'notifications', result,
    'vapid', jsonb_build_object(
      'public', 'BA2cX8pdRfQYtre1ElsYKBj7zpMry00hN3jTNK3vLpoVYgnPfvgTljNKF_03e2AoeNl0Sxc5an4Dnw1G2vd0CpQ',
      'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'),
      'subject', 'https://ocombe.github.io/ours-and-co/'));
end;
$$;

-- Subscriptions the push service says no longer exist (phone reset, permission removed).
create function public.push_forget(p_endpoints text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
$$;

revoke execute on function public.push_take_batch(), public.push_forget(text[]) from public, anon, authenticated;
grant execute on function public.push_take_batch(), public.push_forget(text[]) to service_role;

-- ---------------------------------------------------------------- every minute
-- Calls the Edge Function only when a group is due (no call on quiet minutes).
create function private.push_flush()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.push_queue
    group by list_id, added_by
    having max(created_at) < now() - interval '50 seconds'
  ) then
    perform net.http_post(
      url := 'https://xeobqdfkjbtclosrfhmi.supabase.co/functions/v1/send-push',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
end;
$$;

revoke execute on function private.push_flush() from public, anon, authenticated;

select cron.schedule('push-flush', '* * * * *', 'select private.push_flush()');
