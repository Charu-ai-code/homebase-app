-- Allow dessert + custom meal slots (slug form).
alter table meal_plan_slots drop constraint if exists meal_plan_slots_slot_key_check;
alter table meal_plan_slots add constraint meal_plan_slots_slot_key_check
  check (slot_key ~ '^[a-z][a-z0-9_]{1,31}$');

alter table household_settings
  add column if not exists custom_slots text[] not null default '{}';

alter table recipes
  add column if not exists image_url text;
