-- Editable pantry ("already at home"). When an item runs out it moves to shopping.
create table if not exists pantry_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aisle text not null default 'Pantry',
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists pantry_items_name_lower_idx
  on pantry_items (lower(trim(name)));

insert into pantry_items (name, aisle)
select v.name, v.aisle
from (values
  ('Basmati', 'Pantry'),
  ('Ginger', 'Produce'),
  ('Garam masala', 'Spices'),
  ('Turmeric', 'Spices'),
  ('Cumin seed', 'Spices'),
  ('Ghee', 'Pantry'),
  ('Green chilies', 'Produce'),
  ('Chana dal', 'Pantry'),
  ('Mustard oil', 'Pantry')
) as v(name, aisle)
where not exists (select 1 from pantry_items limit 1);
