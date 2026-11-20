-- Step 2: weekly menu (no days), wishes, eaten parts feeding the history.

-- A menu covers one week, starting on the Saturday market day.
create table public.menus (
  id            bigint generated always as identity primary key,
  starts_on     date not null unique check (extract(isodow from starts_on) = 6),
  need_midi     smallint not null default 5 check (need_midi between 0 and 14),    -- weekday lunches, 2 people
  need_weekend  smallint not null default 2 check (need_weekend between 0 and 6),  -- weekend lunches, 4 people
  need_soir     smallint not null default 7 check (need_soir between 0 and 14),    -- dinners, 2 people
  created_at    timestamptz not null default now()
);

-- A dish in a menu. kind = which meals it covers; meals = how many of them.
create table public.menu_items (
  id          bigint generated always as identity primary key,
  menu_id     bigint not null references public.menus (id) on delete cascade,
  dish_id     bigint references public.dishes (id) on delete set null,
  label       text not null,                        -- dish name at the time (survives dish deletion)
  kind        text not null check (kind in ('midi', 'weekend', 'soir')),
  meals       smallint not null default 1 check (meals between 1 and 10),
  eaten       smallint not null default 0 check (eaten >= 0),
  source      text not null default 'manual' check (source in ('generated', 'manual', 'wish', 'leftover')),
  day         date,                                 -- optional, for a future day view
  created_at  timestamptz not null default now(),
  check (eaten <= meals)
);

create index menu_items_menu_idx on public.menu_items (menu_id);
create index menu_items_dish_idx on public.menu_items (dish_id);

-- Dishes we want in the next menu (promo, craving...).
create table public.wishes (
  id          bigint generated always as identity primary key,
  dish_id     bigint not null references public.dishes (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

create index wishes_dish_idx on public.wishes (dish_id);

-- Eating a part of a menu item writes a history row linked to it.
alter table public.history add column menu_item_id bigint references public.menu_items (id) on delete set null;
create index history_menu_item_idx on public.history (menu_item_id);

alter table public.menus      enable row level security;
alter table public.menu_items enable row level security;
alter table public.wishes     enable row level security;

create policy household_all on public.menus
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.menu_items
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.wishes
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));

revoke all on public.menus, public.menu_items, public.wishes from anon;
grant select, insert, update, delete on public.menus, public.menu_items, public.wishes to authenticated;

alter publication supabase_realtime add table public.menus, public.menu_items, public.wishes;

-- ---------------------------------------------------------------- Claude helpers
-- Find one dish by (accent-insensitive) name; errors if none or ambiguous.
create function claude.dish_by_name(p_name text)
returns public.dishes
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.dishes;
  n int;
begin
  select count(*) into n from public.dishes
   where extensions.unaccent(lower(name)) = extensions.unaccent(lower(trim(p_name)));
  if n = 1 then
    select * into v from public.dishes
     where extensions.unaccent(lower(name)) = extensions.unaccent(lower(trim(p_name)));
    return v;
  end if;
  raise exception 'Plat "%" introuvable ou ambigu : utilise claude.find_dishes pour trouver le nom exact', p_name;
end;
$$;

-- Add a wish for the next menu.
create function claude.add_wish(p_dish text, p_note text default null)
returns public.wishes
language plpgsql
set search_path = ''
as $$
declare
  w public.wishes;
begin
  insert into public.wishes (dish_id, note)
  values ((claude.dish_by_name(p_dish)).id, p_note)
  returning * into w;
  return w;
end;
$$;

-- Add a dish to the current (latest) menu. p_kind: midi, weekend or soir.
create function claude.add_to_menu(p_dish text, p_kind text default null)
returns public.menu_items
language plpgsql
set search_path = ''
as $$
declare
  d public.dishes;
  m public.menus;
  k text;
  it public.menu_items;
begin
  d := claude.dish_by_name(p_dish);
  select * into m from public.menus order by starts_on desc limit 1;
  if m.id is null then
    raise exception 'Aucun menu : crée d''abord la semaine dans l''appli';
  end if;
  k := coalesce(p_kind, case when d.usual_moment = 'midi' then 'midi' else 'soir' end);
  insert into public.menu_items (menu_id, dish_id, label, kind, meals, source)
  values (m.id, d.id, d.name, k,
          case when k = 'weekend' then greatest(1, d.meals_covered / 2) else d.meals_covered end,
          'manual')
  returning * into it;
  return it;
end;
$$;

revoke all on all functions in schema claude from public, anon, authenticated;
