-- Protect manually edited shopping rows from meal-plan sync overwrites.
alter table shopping_list_items
  add column if not exists manual_override boolean not null default false;
