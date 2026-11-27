-- A free note on each shopping item ("bio", "pour la quiche", "la marque verte"…).
alter table public.list_items add column note text;

-- claude.add_to_list takes an optional note.
drop function claude.add_to_list(text, text, text);

create function claude.add_to_list(p_list text, p_label text, p_quantity text default null, p_note text default null)
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
  insert into public.list_items (list_id, label, quantity, note)
  values (l.id, trim(p_label), p_quantity, nullif(trim(p_note), ''))
  returning * into it;
  return it;
end;
$$;

revoke all on function claude.add_to_list(text, text, text, text) from public, anon, authenticated;
