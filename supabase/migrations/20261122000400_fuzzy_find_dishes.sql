-- claude.find_dishes: fuzzy, like the app's search. Forgives typos ("tartifelte"),
-- accents and plural, matches old FamilyWall names and ingredients; best matches first.
create extension if not exists pg_trgm with schema extensions;

create or replace function claude.find_dishes(p_query text)
returns setof public.dishes
language sql
stable
set search_path = ''
as $$
  with q as (select extensions.unaccent(lower(trim(p_query))) as q)
  select d.*
  from public.dishes d
  cross join q
  cross join lateral (
    select greatest(
      extensions.word_similarity(q.q, extensions.unaccent(lower(d.name || ' ' || array_to_string(d.aliases, ' ')))),
      0.8 * coalesce((
        select max(extensions.word_similarity(q.q, extensions.unaccent(lower(i.name))))
        from public.dish_ingredients di
        join public.ingredients i on i.id = di.ingredient_id
        where di.dish_id = d.id), 0)
    ) as score
  ) s
  where s.score >= 0.45
  order by s.score desc, d.name;
$$;

revoke all on function claude.find_dishes(text) from public, anon, authenticated;
