-- Shopping list is week-scoped and rebuilt from that week's meal plan.
alter table shopping_list_items
  add column if not exists week_start date;

alter table shopping_list_items
  add column if not exists source text not null default 'manual';

alter table shopping_list_items
  drop constraint if exists shopping_list_items_source_check;

alter table shopping_list_items
  add constraint shopping_list_items_source_check
  check (source in ('meal_plan', 'manual'));

create index if not exists shopping_list_items_week_idx
  on shopping_list_items (week_start);

-- Drop legacy global (unscoped) list; weekly sync recreates from recipes.
delete from shopping_list_items where week_start is null;
