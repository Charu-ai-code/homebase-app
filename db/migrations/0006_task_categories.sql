-- Custom household task categories + allow slug tags beyond the original five.
alter table household_settings
  add column if not exists custom_task_tags text[] not null default '{}';

alter table household_tasks drop constraint if exists household_tasks_tag_check;
alter table household_tasks
  add constraint household_tasks_tag_check
  check (tag ~ '^[a-z][a-z0-9_]{0,31}$');
