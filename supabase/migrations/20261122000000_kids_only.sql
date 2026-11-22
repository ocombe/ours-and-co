-- Dishes only for the girls (e.g. cordons bleus): they go in a separate "Pour les filles"
-- part of the menu and do not count towards the meals to cover.
alter table public.dishes add column kids_only boolean not null default false;

alter table public.menu_items drop constraint menu_items_kind_check;
alter table public.menu_items
  add constraint menu_items_kind_check check (kind in ('midi', 'weekend', 'soir', 'kids'));

-- Add a dish to the current (latest) menu. p_kind: midi, weekend, soir or kids
-- (default: kids for a kids-only dish, else from its usual moment).
create or replace function claude.add_to_menu(p_dish text, p_kind text default null)
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
  k := coalesce(p_kind, case when d.kids_only then 'kids' when d.usual_moment = 'midi' then 'midi' else 'soir' end);
  insert into public.menu_items (menu_id, dish_id, label, kind, meals, source)
  values (m.id, d.id, d.name, k,
          case when k = 'weekend' then greatest(1, d.meals_covered / 2) else d.meals_covered end,
          'manual')
  returning * into it;
  return it;
end;
$$;

revoke all on function claude.add_to_menu(text, text) from public, anon, authenticated;
