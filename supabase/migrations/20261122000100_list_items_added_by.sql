-- Shopping lists: who added each item (shown with their Google photo), and a "nouveau"
-- badge on items the other person added since my last visit.

-- Google photo of each member, copied from their account on sign-in.
alter table public.members add column avatar_url text;
-- When the member last opened the shopping lists.
alter table public.members add column lists_seen_at timestamptz;

-- Who added the item: the signed-in member, or null (Claude from a chat, FamilyWall import).
alter table public.list_items
  add column added_by uuid default auth.uid() references auth.users (id) on delete set null;

-- New accounts: become members with their photo.
create or replace function private.add_allowed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (user_id, display_name, avatar_url)
  select new.id, a.display_name, new.raw_user_meta_data ->> 'avatar_url'
  from private.allowed_members a
  where a.email = lower(new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Google sends the photo again on each sign-in: keep it up to date.
create function private.sync_member_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members
  set avatar_url = new.raw_user_meta_data ->> 'avatar_url'
  where user_id = new.id
    and avatar_url is distinct from new.raw_user_meta_data ->> 'avatar_url';
  return new;
end;
$$;

revoke execute on function private.sync_member_avatar() from public, anon, authenticated;

create trigger on_auth_user_updated_sync_avatar
  after update of raw_user_meta_data on auth.users
  for each row execute function private.sync_member_avatar();

update public.members m
set avatar_url = u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
where u.id = m.user_id;

-- Opening the lists: remember now as my last visit and return the previous one,
-- so the app can mark what was added since.
-- (Replaced by a security invoker version in the next migration.)
create function public.mark_lists_seen()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  with previous as (
    select lists_seen_at from public.members where user_id = (select auth.uid())
  )
  update public.members
  set lists_seen_at = now()
  where user_id = (select auth.uid())
  returning (select lists_seen_at from previous);
$$;

revoke execute on function public.mark_lists_seen() from public, anon;
grant execute on function public.mark_lists_seen() to authenticated;
