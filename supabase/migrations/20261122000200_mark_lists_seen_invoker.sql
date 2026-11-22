-- Opening the lists: remember now as my last visit and return the previous one,
-- so the app can mark what was added since. Runs as the caller: members may only
-- change their own lists_seen_at (column grant + policy below).
revoke update on public.members from authenticated;
grant update (lists_seen_at) on public.members to authenticated;

create policy members_update_own_seen on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop function public.mark_lists_seen();

create function public.mark_lists_seen()
returns timestamptz
language sql
security invoker
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

create index list_items_added_by_idx on public.list_items (added_by);
