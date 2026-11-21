-- Step 3: shopping lists (any list, really) and the reserve (freezer / pantry stock).

create table public.lists (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) > 0),
  position    smallint not null default 0,
  created_at  timestamptz not null default now()
);

create unique index lists_name_unique on public.lists (lower(name));

create table public.list_items (
  id             bigint generated always as identity primary key,
  list_id        bigint not null references public.lists (id) on delete cascade,
  label          text not null check (length(trim(label)) > 0),
  quantity       text,                       -- free text: "200 g", "2", "1 botte"
  done           boolean not null default false,
  ingredient_id  bigint references public.ingredients (id) on delete set null,
  menu_id        bigint references public.menus (id) on delete set null,  -- set when filled from a menu
  created_at     timestamptz not null default now()
);

create index list_items_list_idx on public.list_items (list_id);
create index list_items_ingredient_idx on public.list_items (ingredient_id);
create index list_items_menu_idx on public.list_items (menu_id);

create table public.reserve_items (
  id             bigint generated always as identity primary key,
  label          text not null check (length(trim(label)) > 0),
  quantity       text,
  location       text not null default 'congélateur' check (location in ('congélateur', 'frigo', 'placard')),
  ingredient_id  bigint references public.ingredients (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index reserve_items_ingredient_idx on public.reserve_items (ingredient_id);

-- Shopping lists coming from FamilyWall.
insert into public.lists (name, position) values
  ('Marché', 1), ('Carrefour', 2), ('Picard', 3), ('Courses', 4),
  ('Pharmacie', 5), ('Vrac', 6), ('Bricolage', 7), ('Ikea', 8);

alter table public.lists         enable row level security;
alter table public.list_items    enable row level security;
alter table public.reserve_items enable row level security;

create policy household_all on public.lists
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.list_items
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.reserve_items
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));

revoke all on public.lists, public.list_items, public.reserve_items from anon;
grant select, insert, update, delete on public.lists, public.list_items, public.reserve_items to authenticated;

alter publication supabase_realtime add table public.lists, public.list_items, public.reserve_items;

-- ---------------------------------------------------------------- Claude helpers
-- Add an item to a list by list name (accent/case-insensitive).
create function claude.add_to_list(p_list text, p_label text, p_quantity text default null)
returns public.list_items
language plpgsql
set search_path = ''
as $$
declare
  l public.lists;
  it public.list_items;
begin
  select * into l from public.lists
   where extensions.unaccent(lower(name)) = extensions.unaccent(lower(trim(p_list)));
  if l.id is null then
    raise exception 'Liste "%" introuvable. Listes : %', p_list,
      (select string_agg(name, ', ' order by position) from public.lists);
  end if;
  insert into public.list_items (list_id, label, quantity)
  values (l.id, trim(p_label), p_quantity)
  returning * into it;
  return it;
end;
$$;

-- Add something to the reserve. p_location: congélateur, frigo or placard.
create function claude.add_to_reserve(p_label text, p_quantity text default null, p_location text default 'congélateur')
returns public.reserve_items
language plpgsql
set search_path = ''
as $$
declare
  r public.reserve_items;
begin
  insert into public.reserve_items (label, quantity, location, ingredient_id)
  values (trim(p_label), p_quantity, p_location,
          (select id from public.ingredients
            where extensions.unaccent(lower(name)) = extensions.unaccent(lower(trim(p_label)))))
  returning * into r;
  return r;
end;
$$;

revoke all on all functions in schema claude from public, anon, authenticated;
