-- Ours & Co — step 1: household members, dishes, ingredients, history.
-- Access model: one household. Every signed-in user listed in public.members
-- can read and write everything; anyone else (even signed in) sees nothing.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------- members
create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

alter table public.members enable row level security;

-- Helper used by every policy: is the caller a household member?
-- security definer so it can read public.members without hitting members' own
-- RLS (which would recurse). Lives in a schema the Data API does not expose,
-- and only answers about the caller (auth.uid()).
create schema private;
grant usage on schema private to authenticated;

create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

revoke execute on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

create policy members_select on public.members
  for select to authenticated
  using ((select private.is_member()));

-- ---------------------------------------------------------------- shared helpers
create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- dishes
create table public.dishes (
  id              bigint generated always as identity primary key,
  name            text not null check (length(trim(name)) > 0),
  category        text not null,
  usual_moment    text not null default 'soir'
                  check (usual_moment in ('midi', 'soir', 'both', 'dessert')),
  meals_covered   smallint not null default 1 check (meals_covered between 1 and 10),
  kids_ok         boolean,                      -- null = not set yet
  season          text not null default 'all' check (season in ('all', 'winter', 'summer')),
  effort          text check (effort in ('quick', 'long')),
  favorite        boolean not null default false,
  to_review       boolean not null default false, -- the ❓ from the import
  notes           text,
  link            text,
  aliases         text[] not null default '{}',   -- old FamilyWall spellings, used by search
  familywall_box  text[] not null default '{}',   -- matching FamilyWall recipe-box titles
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index dishes_name_unique on public.dishes (lower(name));

create trigger dishes_updated_at before update on public.dishes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ingredients
create table public.ingredients (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) > 0),
  store       text,   -- preferred store: Marché, Carrefour, Picard...
  aisle       text,
  created_at  timestamptz not null default now()
);

create unique index ingredients_name_unique on public.ingredients (lower(name));

create table public.dish_ingredients (
  dish_id        bigint not null references public.dishes (id) on delete cascade,
  ingredient_id  bigint not null references public.ingredients (id) on delete restrict,
  quantity       numeric check (quantity is null or quantity > 0), -- for 2 people
  unit           text,
  primary key (dish_id, ingredient_id)
);

create index dish_ingredients_ingredient_idx on public.dish_ingredients (ingredient_id);

-- ---------------------------------------------------------------- history
create table public.history (
  id           bigint generated always as identity primary key,
  dish_id      bigint references public.dishes (id) on delete set null,
  label        text not null,          -- name as written at the time
  eaten_on     date,                   -- null for FamilyWall imports (no dates)
  moment       text check (moment in ('midi', 'soir')),
  people       smallint check (people between 1 and 20),
  source       text not null default 'app' check (source in ('app', 'familywall')),
  legacy_rank  integer,                -- FamilyWall order: higher = more recent
  created_at   timestamptz not null default now()
);

create index history_dish_idx on public.history (dish_id);
create index history_eaten_on_idx on public.history (eaten_on);

-- ---------------------------------------------------------------- RLS + grants
alter table public.dishes           enable row level security;
alter table public.ingredients      enable row level security;
alter table public.dish_ingredients enable row level security;
alter table public.history          enable row level security;

create policy household_all on public.dishes
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.ingredients
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.dish_ingredients
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy household_all on public.history
  for all to authenticated using ((select private.is_member())) with check ((select private.is_member()));

revoke all on public.members, public.dishes, public.ingredients, public.dish_ingredients, public.history from anon;
grant select on public.members to authenticated;
grant select, insert, update, delete
  on public.dishes, public.ingredients, public.dish_ingredients, public.history to authenticated;

-- ---------------------------------------------------------------- Claude helpers
-- Called by Claude through the Supabase connector (runs as postgres).
-- Not exposed to the app's API.
create schema claude;
revoke all on schema claude from public, anon, authenticated;

-- Accent- and case-insensitive search on dish names, aliases and ingredients.
create function claude.find_dishes(p_query text)
returns setof public.dishes
language sql
stable
set search_path = ''
as $$
  select d.*
  from public.dishes d
  where extensions.unaccent(lower(d.name || ' ' || array_to_string(d.aliases, ' ')))
        like '%' || extensions.unaccent(lower(p_query)) || '%'
     or exists (
          select 1
          from public.dish_ingredients di
          join public.ingredients i on i.id = di.ingredient_id
          where di.dish_id = d.id
            and extensions.unaccent(lower(i.name)) like '%' || extensions.unaccent(lower(p_query)) || '%')
  order by d.name;
$$;

-- Add a dish; fails clearly if a dish with the same name already exists.
create function claude.add_dish(
  p_name          text,
  p_category      text,
  p_usual_moment  text default 'soir',
  p_meals_covered int default 1,
  p_kids_ok       boolean default null,
  p_season        text default 'all',
  p_notes         text default null,
  p_link          text default null
)
returns public.dishes
language plpgsql
set search_path = ''
as $$
declare
  v_dish public.dishes;
begin
  if exists (select 1 from public.dishes where lower(name) = lower(trim(p_name))) then
    raise exception 'Le plat "%" existe déjà', trim(p_name);
  end if;
  insert into public.dishes (name, category, usual_moment, meals_covered, kids_ok, season, notes, link)
  values (trim(p_name), p_category, p_usual_moment, p_meals_covered, p_kids_ok, p_season, p_notes, p_link)
  returning * into v_dish;
  return v_dish;
end;
$$;

revoke all on all functions in schema claude from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
