-- Custom shopping list categories beyond the default set.
alter table household_settings
  add column if not exists custom_shop_categories text[] not null default '{}';
