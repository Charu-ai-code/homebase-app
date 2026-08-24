-- Track whether a planned meal was eaten or skipped.
alter table meal_plan_slots
  add column if not exists log_status text not null default 'planned';

alter table meal_plan_slots
  drop constraint if exists meal_plan_slots_log_status_check;

alter table meal_plan_slots
  add constraint meal_plan_slots_log_status_check
  check (log_status in ('planned', 'eaten', 'skipped'));
