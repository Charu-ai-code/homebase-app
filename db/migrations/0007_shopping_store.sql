-- Where to buy (Costco, Indian grocery, etc.) on shopping + pantry items
alter table shopping_list_items
  add column if not exists store text;

alter table pantry_items
  add column if not exists store text;
