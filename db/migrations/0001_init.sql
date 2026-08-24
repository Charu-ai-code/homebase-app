-- HomeBase v2 schema — plain Postgres, for Neon.
-- Run once via the Neon SQL Editor (or `psql "$DATABASE_URL" -f db/migrations/0001_init.sql`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- people

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#201e1d',
  calorie_target int not null default 2000,
  pin_hash text not null,          -- sha256(pin + PIN_SALT), verified in api/auth/login.js
  created_at timestamptz not null default now()
);

create table household_settings (
  id boolean primary key default true,
  protein_floor_g int not null default 110,
  constraint single_row check (id)
);
insert into household_settings (id) values (true);

-- ---------------------------------------------------------------- recipes

create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  minutes int,
  marinate_hours numeric,
  method jsonb not null default '[]'::jsonb,      -- ordered array of step strings ("our version")
  kcal int,
  protein int,
  servings text,
  source_name text,
  source_url text,
  source_snapshot jsonb,                          -- frozen {ingredients:[...], method:[...]} as imported
  tags text[] not null default '{}',
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  sort_order int not null default 0,
  name text not null,
  qty text,
  aisle text,           -- 'Produce' | 'Meat + dairy' | 'Pantry' | 'Frozen' | ...
  note text
);
create index recipe_ingredients_recipe_id_idx on recipe_ingredients (recipe_id);

-- ---------------------------------------------------------------- meal plan

create table meal_plan_slots (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  slot_key text not null check (slot_key in ('drink','breakfast','shake','lunch','snack','dinner')),
  recipe_id uuid references recipes(id),
  adhoc_name text,                 -- escape hatch for trivial items not worth a recipe row
  kcal int not null default 0,
  protein int not null default 0,
  updated_by uuid references people(id),
  updated_at timestamptz not null default now(),
  unique (plan_date, slot_key),
  check (recipe_id is not null or adhoc_name is not null)
);

-- ---------------------------------------------------------------- calendar

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time not null,
  end_time time,
  title text not null,
  person_id uuid references people(id),   -- null = shared/both
  is_prep boolean not null default false,
  is_highlight boolean not null default false,
  is_suggested boolean not null default false,
  done boolean not null default false,
  source text not null default 'manual' check (source in ('manual','google')),
  external_event_id text,
  created_at timestamptz not null default now()
);
create index calendar_events_date_idx on calendar_events (event_date);

-- ---------------------------------------------------------------- tasks

create table household_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  person_id uuid references people(id),   -- null = shared
  due_date date,
  tag text not null default 'errands' check (tag in ('cleaning','laundry','bills','car','errands')),
  done boolean not null default false,
  suggested boolean not null default false,
  suggested_time time,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- shopping list

create table shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty text,
  aisle text not null default 'Other',
  note text,
  checked boolean not null default false,
  added_by uuid references people(id),
  created_at timestamptz not null default now()
);

create table shopping_item_recipes (
  shopping_item_id uuid not null references shopping_list_items(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  qty_contributed text,
  primary key (shopping_item_id, recipe_id)
);

-- ---------------------------------------------------------------- external accounts + whoop

create table external_accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  provider text not null check (provider in ('google','spotify')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  provider_account_email text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, provider)
);

create table whoop_manual_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  entry_date date not null,
  recovery_pct int,
  sleep_minutes int,
  strain numeric,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (person_id, entry_date)
);

-- ---------------------------------------------------------------- ai insight cache

-- Keeps generated AI sentences around until their underlying data changes,
-- so we don't call Kimi on every render.
create table ai_insight_cache (
  cache_key text primary key,       -- e.g. 'dashboard-priority', 'mealplan-week:2026-08-24'
  content text not null,
  generated_at timestamptz not null default now()
);

-- Authorization note: Neon has no built-in auth/RLS layer like Supabase. Every
-- /api/*.js function is responsible for checking the session cookie itself before
-- touching these tables (see api/_auth.js). Trust model: any logged-in household
-- member (Charu or Shreya) can read/write every shared table; external_accounts
-- rows are additionally filtered to their own person_id in application code.
