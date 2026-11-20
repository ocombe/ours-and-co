-- Difficulty: quick / normal / long. Long dishes are rarer and max one per week.
alter table public.dishes drop constraint dishes_effort_check;
alter table public.dishes add constraint dishes_effort_check check (effort in ('quick', 'normal', 'long'));
-- (data) first guesses for long dishes were applied directly to the database.
