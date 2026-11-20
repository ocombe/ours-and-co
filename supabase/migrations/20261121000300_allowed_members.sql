-- Household accounts are created on first sign-in (Google or e-mail link).
-- If the e-mail is in private.allowed_members, the new account becomes a member
-- automatically. The e-mails themselves are inserted directly in the database,
-- not in this public repository.

create table private.allowed_members (
  email        text primary key check (email = lower(email)),
  display_name text not null
);

alter table private.allowed_members enable row level security;
revoke all on private.allowed_members from public, anon, authenticated;

create function private.add_allowed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (user_id, display_name)
  select new.id, a.display_name
  from private.allowed_members a
  where a.email = lower(new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.add_allowed_member() from public, anon, authenticated;

create trigger on_auth_user_created_add_member
  after insert on auth.users
  for each row execute function private.add_allowed_member();
