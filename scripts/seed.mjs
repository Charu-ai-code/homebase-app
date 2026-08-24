import './load-env.mjs';
import { SEED_DATA, COOKBOOK_RECIPES, DINNER_INGREDIENTS, hashPin, neon } from './seed-data.mjs';

const SLOT_KEYS = ['drink', 'breakfast', 'shake', 'lunch', 'snack', 'dinner'];

async function upsertRecipe(sql, recipe, peopleByKey) {
  const existing = await sql`select id from recipes where name = ${recipe.name}`;
  let id;
  const imageUrl = recipe.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent(recipe.name + ', plated food photography')}?width=800&height=1000&nologo=true`;
  if (existing.length) {
    id = existing[0].id;
    await sql`
      update recipes set
        minutes = ${recipe.minutes ?? null},
        marinate_hours = ${recipe.marinateHours ?? null},
        method = ${JSON.stringify(recipe.method || [])},
        kcal = ${recipe.kcal ?? null},
        protein = ${recipe.protein ?? null},
        servings = ${recipe.servings || null},
        tags = ${recipe.tags || []},
        image_url = coalesce(image_url, ${imageUrl}),
        updated_at = now()
      where id = ${id}
    `;
  } else {
    const rows = await sql`
      insert into recipes (name, minutes, marinate_hours, method, kcal, protein, servings, tags, image_url, created_by)
      values (
        ${recipe.name}, ${recipe.minutes ?? null}, ${recipe.marinateHours ?? null},
        ${JSON.stringify(recipe.method || [])}, ${recipe.kcal ?? null}, ${recipe.protein ?? null},
        ${recipe.servings || null}, ${recipe.tags || []}, ${imageUrl}, ${peopleByKey.charu || null}
      )
      returning id
    `;
    id = rows[0].id;
  }

  if (recipe.ingredients?.length) {
    await sql`delete from recipe_ingredients where recipe_id = ${id}`;
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i];
      await sql`
        insert into recipe_ingredients (recipe_id, sort_order, name, qty, aisle, note)
        values (${id}, ${i}, ${ing.name}, ${ing.qty || null}, ${ing.aisle || 'Other'}, ${ing.note || null})
      `;
    }
  }
  return id;
}

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const peopleByKey = {};

  console.log('Seeding people...');
  for (const p of SEED_DATA.people) {
    const existing = await sql`select id from people where name = ${p.name}`;
    if (existing.length) {
      peopleByKey[p.key] = existing[0].id;
      await sql`update people set pin_hash = ${hashPin(p.pin)} where id = ${existing[0].id}`;
    } else {
      const rows = await sql`
        insert into people (name, color, calorie_target, pin_hash)
        values (${p.name}, ${p.color}, ${p.calorieTarget}, ${hashPin(p.pin)})
        returning id
      `;
      peopleByKey[p.key] = rows[0].id;
    }
  }

  console.log('Seeding WHOOP entries...');
  for (const [key, w] of Object.entries(SEED_DATA.whoop)) {
    const personId = peopleByKey[key];
    await sql`
      insert into whoop_manual_entries (person_id, entry_date, recovery_pct, sleep_minutes, strain)
      values (${personId}, ${'2026-08-27'}, ${w.recovery}, ${w.sleepMinutes}, ${w.strain})
      on conflict (person_id, entry_date) do update
      set recovery_pct = excluded.recovery_pct,
          sleep_minutes = excluded.sleep_minutes,
          strain = excluded.strain
    `;
  }

  const recipeIds = {};
  console.log('Seeding recipes + meals + events...');
  const seedDates = SEED_DATA.week.map((d) => d.date);
  const seedFrom = seedDates[0];
  const seedTo = seedDates[seedDates.length - 1];
  await sql`delete from meal_plan_slots where plan_date < ${seedFrom}::date or plan_date > ${seedTo}::date`;

  for (const day of SEED_DATA.week) {
    const dinner = day.meals.dinner;
    if (!recipeIds[dinner.name]) {
      recipeIds[dinner.name] = await upsertRecipe(sql, {
        name: dinner.name,
        minutes: dinner.minutes || 30,
        method: dinner.method || ['stovetop'],
        kcal: dinner.kcal,
        protein: dinner.protein,
        ingredients: DINNER_INGREDIENTS[dinner.name] || [],
        tags: ['dinner'],
      }, peopleByKey);
    }

    for (const slot of SLOT_KEYS) {
      const meal = day.meals[slot];
      const recipeId = slot === 'dinner' ? recipeIds[dinner.name] : null;
      await sql`
        insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein)
        values (
          ${day.date}, ${slot}, ${recipeId},
          ${recipeId ? null : meal.name}, ${meal.kcal}, ${meal.protein}
        )
        on conflict (plan_date, slot_key) do update
        set adhoc_name = excluded.adhoc_name,
            kcal = excluded.kcal,
            protein = excluded.protein,
            recipe_id = coalesce(excluded.recipe_id, meal_plan_slots.recipe_id)
      `;
    }

    const existingEvents = await sql`
      select count(*)::int as n from calendar_events
      where event_date = ${day.date} and source = 'manual'
    `;
    if (!existingEvents[0].n) {
      for (const ev of day.events) {
        const personId = ev.person === 'shared' ? null : peopleByKey[ev.person];
        await sql`
          insert into calendar_events (
            event_date, start_time, end_time, title, person_id,
            is_prep, is_highlight, is_suggested, source
          ) values (
            ${day.date}, ${ev.start}, ${ev.end || null}, ${ev.title}, ${personId},
            ${!!ev.prep}, ${!!ev.highlight}, ${!!ev.suggested}, 'manual'
          )
        `;
      }
    }
  }

  console.log('Seeding cookbook recipes...');
  for (const recipe of COOKBOOK_RECIPES) {
    recipeIds[recipe.name] = await upsertRecipe(sql, recipe, peopleByKey);
  }

  console.log('Seeding household tasks...');
  for (const t of SEED_DATA.tasks) {
    const personId = t.person === 'shared' ? null : peopleByKey[t.person];
    const existing = await sql`select id from household_tasks where title = ${t.title}`;
    if (existing.length) continue;
    await sql`
      insert into household_tasks (title, person_id, due_date, tag, done, suggested, suggested_time, note)
      values (
        ${t.title}, ${personId}, ${t.due || null}, ${t.tag},
        ${!!t.done}, ${!!t.suggested}, ${t.suggestedTime || null}, ${t.note || null}
      )
    `;
  }

  console.log('Seeding shopping list...');
  for (const group of SEED_DATA.shopping) {
    for (const item of group.items) {
      const existing = await sql`
        select id from shopping_list_items where name = ${item.name} and aisle = ${group.aisle}
      `;
      let itemId;
      if (existing.length) {
        itemId = existing[0].id;
      } else {
        const rows = await sql`
          insert into shopping_list_items (name, qty, aisle, note, checked)
          values (${item.name}, ${item.qty}, ${group.aisle}, ${item.note || ''}, ${!!item.checked})
          returning id
        `;
        itemId = rows[0].id;
      }

      for (const [recipeName, rid] of Object.entries(recipeIds)) {
        if ((item.note || '').includes(recipeName) || (item.note || '').includes(recipeName.split(' ')[0])) {
          await sql`
            insert into shopping_item_recipes (shopping_item_id, recipe_id, qty_contributed)
            values (${itemId}, ${rid}, ${item.qty})
            on conflict do nothing
          `;
        }
      }
    }
  }

  console.log('Seed complete.');
  console.log('Recipes in book:', Object.keys(recipeIds).length);
  console.log('PINs (dev defaults): Charu =', process.env.CHARU_PIN || '1234', '| Shreya =', process.env.SHREYA_PIN || '5678');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
