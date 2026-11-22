-- Ticking a meal part as eaten (or not) in one call: history row and counter change
-- together, in one transaction, and the counter is computed in the database (two
-- phones ticking at once no longer lose a tick). Runs as the caller (RLS applies).

-- One more part of a menu item eaten on p_on (the phone's local date).
create function public.eat_part(p_item bigint, p_on date)
returns public.menu_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it public.menu_items;
  usual text;
begin
  update public.menu_items set eaten = eaten + 1
  where id = p_item and eaten < meals
  returning * into it;
  if it.id is null then
    raise exception 'Toutes les parts sont déjà mangées';
  end if;
  select usual_moment into usual from public.dishes where id = it.dish_id;
  insert into public.history (dish_id, label, eaten_on, moment, people, menu_item_id)
  values (
    it.dish_id, it.label, p_on,
    case when it.kind = 'soir' or (it.kind = 'kids' and usual is distinct from 'midi') then 'soir' else 'midi' end,
    case when it.kind = 'weekend' then 4 else 2 end,
    it.id);
  return it;
end;
$$;

-- Undo the last eaten part of a menu item (and its history row).
create function public.uneat_part(p_item bigint)
returns public.menu_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it public.menu_items;
begin
  update public.menu_items set eaten = eaten - 1
  where id = p_item and eaten > 0
  returning * into it;
  if it.id is null then
    raise exception 'Aucune part mangée à annuler';
  end if;
  delete from public.history
  where id = (select max(id) from public.history where menu_item_id = p_item);
  return it;
end;
$$;

revoke execute on function public.eat_part(bigint, date), public.uneat_part(bigint) from public, anon;
grant execute on function public.eat_part(bigint, date), public.uneat_part(bigint) to authenticated;
