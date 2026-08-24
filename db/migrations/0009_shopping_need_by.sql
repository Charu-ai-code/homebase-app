-- Need-by date (auto from meal plan or manual) + priority on shopping items.
alter table shopping_list_items
  add column if not exists need_by date,
  add column if not exists need_by_override boolean not null default false,
  add column if not exists priority text not null default 'normal',
  add column if not exists priority_override boolean not null default false;

alter table shopping_list_items drop constraint if exists shopping_list_items_priority_check;
alter table shopping_list_items
  add constraint shopping_list_items_priority_check
  check (priority in ('high', 'normal', 'low'));

-- Rebuild need-by dates on next bootstrap
delete from ai_insight_cache where cache_key like 'shopping-sync:%';
