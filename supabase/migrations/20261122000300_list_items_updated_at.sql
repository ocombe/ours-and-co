-- Shopping lists show when each item was last modified (added, renamed, quantity,
-- aisle, ticked…), not only when it was added.
alter table public.list_items add column updated_at timestamptz not null default now();

update public.list_items set updated_at = created_at;

create trigger list_items_updated_at before update on public.list_items
  for each row execute function public.set_updated_at();
