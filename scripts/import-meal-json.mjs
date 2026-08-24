#!/usr/bin/env node
/**
 * Import HomeBase meal-prep JSON (recipes + meal plan + prep tasks).
 * Usage: node scripts/import-meal-json.mjs [path/to/file.json]
 */
import './load-env.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, '../data/homebase_seed_aug24_2026_two_person.json');
const filePath = process.argv[2] || defaultPath;

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseMethod(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.includes(' | ')) return s.split(' | ').map((x) => x.trim()).filter(Boolean);
  if (s.includes('\n')) return s.split('\n').map((x) => x.trim()).filter(Boolean);
  return [s];
}

function imageUrlFor(name) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(name + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true`;
}

function mealSlotKey(row) {
  const slot = row.slot;
  if (row.who_eats === 'charu' && slot === 'lunch') return 'lunch_charu';
  return slot;
}

async function upsertRecipe(sql, recipe, ingredients, charuPersonId) {
  const name = recipe.recipe_name;
  const existing = await sql`select id from recipes where name = ${name}`;
  const method = parseMethod(recipe.method);
  const tags = parseTags(recipe.tags);
  if (recipe.meal_type && !tags.includes(recipe.meal_type)) tags.unshift(recipe.meal_type);
  const imageUrl = recipe.image_url || imageUrlFor(name);
  const servings = recipe.servings != null ? String(recipe.servings) : null;

  let id;
  if (existing.length) {
    id = existing[0].id;
    await sql`
      update recipes set
        minutes = ${recipe.minutes ?? null},
        marinate_hours = ${recipe.marinate_hours ?? null},
        method = ${JSON.stringify(method)},
        kcal = ${recipe.kcal ?? null},
        protein = ${recipe.protein_g ?? null},
        servings = ${servings},
        tags = ${tags},
        source_name = ${recipe.source_name || null},
        source_url = ${recipe.source_url || null},
        image_url = coalesce(${imageUrl}, image_url),
        updated_at = now()
      where id = ${id}
    `;
  } else {
    const rows = await sql`
      insert into recipes (
        name, minutes, marinate_hours, method, kcal, protein, servings, tags,
        source_name, source_url, image_url, created_by
      ) values (
        ${name}, ${recipe.minutes ?? null}, ${recipe.marinate_hours ?? null},
        ${JSON.stringify(method)}, ${recipe.kcal ?? null}, ${recipe.protein_g ?? null},
        ${servings}, ${tags}, ${recipe.source_name || null}, ${recipe.source_url || null},
        ${imageUrl}, ${charuPersonId}
      )
      returning id
    `;
    id = rows[0].id;
  }

  if (ingredients?.length) {
    await sql`delete from recipe_ingredients where recipe_id = ${id}`;
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      await sql`
        insert into recipe_ingredients (recipe_id, sort_order, name, qty, aisle, note)
        values (${id}, ${i}, ${ing.ingredient}, ${ing.quantity || null}, ${ing.aisle || 'Other'}, ${ing.note || null})
      `;
    }
  }
  return id;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const sql = neon(process.env.DATABASE_URL);

  const people = await sql`select id, name from people order by name`;
  const charu = people.find((p) => p.name.toLowerCase() === 'charu');
  const charuPersonId = charu?.id || null;

  const weekStart = data.week_start;
  const weekEnd = data.week_end;
  if (!weekStart || !weekEnd) {
    throw new Error('JSON must include week_start and week_end');
  }

  console.log(`Importing ${filePath}`);
  console.log(`Week: ${weekStart} → ${weekEnd}`);

  // Custom meal slots used in this plan
  const customSlots = new Set(['snack_am', 'snack_pm', 'before_sleep', 'lunch_charu']);
  for (const row of data.meal_plan || []) {
    if (row.slot && !['drink', 'breakfast', 'shake', 'lunch', 'snack', 'dinner', 'dessert'].includes(row.slot)) {
      customSlots.add(row.slot);
    }
  }

  const existingSettings = await sql`select custom_slots from household_settings where id = true`;
  const merged = [...new Set([...(existingSettings[0]?.custom_slots || []), ...customSlots])];
  await sql`
    update household_settings
    set custom_slots = ${merged}
    where id = true
  `;

  const ingredientsByRecipe = {};
  for (const ing of data.ingredients || []) {
    if (!ingredientsByRecipe[ing.recipe_name]) ingredientsByRecipe[ing.recipe_name] = [];
    ingredientsByRecipe[ing.recipe_name].push(ing);
  }

  const recipeIds = {};
  console.log(`Recipes: ${(data.recipes || []).length}`);
  for (const recipe of data.recipes || []) {
    recipeIds[recipe.recipe_name] = await upsertRecipe(
      sql,
      recipe,
      ingredientsByRecipe[recipe.recipe_name] || [],
      charuPersonId,
    );
  }

  console.log('Clearing existing meal plan for target week…');
  await sql`
    delete from meal_plan_slots
    where plan_date >= ${weekStart}::date and plan_date <= ${weekEnd}::date
  `;

  let mealCount = 0;
  for (const row of data.meal_plan || []) {
    const slotKey = mealSlotKey(row);
    const recipeName = row.recipe_name || row.adhoc_name;
    if (!recipeName) continue;

    const recipeId = recipeIds[row.recipe_name] || null;
    const adhocName = recipeId ? null : recipeName;
    const kcal = row.kcal ?? 0;
    const protein = row.protein_g ?? 0;

    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein)
      values (${row.date}, ${slotKey}, ${recipeId}, ${adhocName}, ${kcal}, ${protein})
      on conflict (plan_date, slot_key) do update
      set recipe_id = excluded.recipe_id,
          adhoc_name = excluded.adhoc_name,
          kcal = excluded.kcal,
          protein = excluded.protein,
          updated_at = now()
    `;
    mealCount++;
  }

  let prepCount = 0;
  for (const prep of data.prep || []) {
    const personRow = prep.person === 'charu' || prep.person === 'shreya'
      ? people.find((p) => p.name.toLowerCase() === prep.person)
      : null;
    const title = prep.task.startsWith('Prep') ? prep.task : `Prep · ${prep.task}`;
    await sql`
      insert into calendar_events (
        event_date, start_time, end_time, title, person_id, is_prep, source
      ) values (
        ${prep.date},
        ${prep.time || '18:00'},
        null,
        ${title},
        ${personRow?.id || null},
        true,
        'manual'
      )
    `;
    prepCount++;
  }

  console.log('Import complete.');
  console.log(`  Recipes: ${Object.keys(recipeIds).length}`);
  console.log(`  Meal slots: ${mealCount}`);
  console.log(`  Custom slots: ${merged.join(', ')}`);
  console.log(`  Prep tasks added: ${prepCount}`);
  if (data.charu_carb_rule) {
    console.log(`  Charu rule: ${data.charu_carb_rule}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
