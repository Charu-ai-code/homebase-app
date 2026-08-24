/** Normalize + import HomeBase JSON from AI chatbots or meal-prep exports. */

export function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseMethod(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.includes(' | ')) return s.split(' | ').map((x) => x.trim()).filter(Boolean);
  if (s.includes('\n')) return s.split('\n').map((x) => x.trim()).filter(Boolean);
  return [s];
}

export function imageUrlFor(name) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(name + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true`;
}

function mealSlotKey(row) {
  const slot = row.slot;
  if (row.who_eats === 'charu' && slot === 'lunch') return 'lunch_charu';
  return slot;
}

function normalizeIngredient(raw, recipeName) {
  return {
    recipe_name: raw.recipe_name || recipeName,
    ingredient: raw.ingredient || raw.name,
    quantity: raw.quantity ?? raw.qty ?? null,
    aisle: raw.aisle || 'Other',
    note: raw.note || null,
  };
}

function normalizeRecipe(raw) {
  const name = raw.recipe_name || raw.name;
  if (!name) return null;
  return {
    recipe_name: name,
    meal_type: raw.meal_type || raw.tag || 'dinner',
    minutes: raw.minutes ?? null,
    marinate_hours: raw.marinate_hours ?? raw.marinateHours ?? null,
    kcal: raw.kcal ?? null,
    protein_g: raw.protein_g ?? raw.protein ?? null,
    servings: raw.servings != null ? String(raw.servings) : null,
    method: raw.method,
    cook_method: raw.cook_method || raw.cookMethod || null,
    tags: raw.tags,
    source_name: raw.source_name || raw.sourceName || null,
    source_url: raw.source_url || raw.sourceUrl || null,
    image_url: raw.image_url || raw.imageUrl || null,
    notes: raw.notes || null,
  };
}

/** Accept single recipe, {recipe, ingredients}, or full week export. */
export function normalizeImportPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('JSON object required');
  }

  let recipes = [];
  let ingredients = [];
  let mealPlan = body.meal_plan || body.mealPlan || [];
  let prep = body.prep || [];
  const weekStart = body.week_start || body.weekStart || null;
  const weekEnd = body.week_end || body.weekEnd || null;

  if (body.recipe_name || body.name) {
    const r = normalizeRecipe(body);
    recipes = [r];
    ingredients = (body.ingredients || []).map((ing) => normalizeIngredient(ing, r.recipe_name));
  } else if (body.recipe) {
    const r = normalizeRecipe(body.recipe);
    recipes = [r];
    ingredients = (body.ingredients || []).map((ing) => normalizeIngredient(ing, r.recipe_name));
  } else if (Array.isArray(body.recipes)) {
    recipes = body.recipes.map(normalizeRecipe).filter(Boolean);
    ingredients = (body.ingredients || []).map((ing) => normalizeIngredient(ing, ing.recipe_name));
  } else {
    throw new Error('Need recipe_name, recipe, or recipes[]');
  }

  return { recipes, ingredients, mealPlan, prep, weekStart, weekEnd };
}

async function upsertRecipe(sql, recipe, ingredients, personId) {
  const name = recipe.recipe_name;
  const existing = await sql`select id from recipes where name = ${name}`;
  const method = parseMethod(recipe.method);
  const tags = parseTags(recipe.tags);
  if (recipe.meal_type && !tags.includes(recipe.meal_type)) tags.unshift(recipe.meal_type);
  if (recipe.cook_method && !tags.includes(recipe.cook_method)) tags.push(recipe.cook_method);
  const imageUrl = recipe.image_url || imageUrlFor(name);

  let id;
  let created = false;
  if (existing.length) {
    id = existing[0].id;
    await sql`
      update recipes set
        minutes = ${recipe.minutes ?? null},
        marinate_hours = ${recipe.marinate_hours ?? null},
        method = ${JSON.stringify(method)},
        kcal = ${recipe.kcal ?? null},
        protein = ${recipe.protein_g ?? null},
        servings = ${recipe.servings ?? null},
        tags = ${tags},
        source_name = coalesce(${recipe.source_name}, source_name),
        source_url = coalesce(${recipe.source_url}, source_url),
        image_url = coalesce(${imageUrl}, image_url),
        updated_at = now()
      where id = ${id}
    `;
  } else {
    created = true;
    const rows = await sql`
      insert into recipes (
        name, minutes, marinate_hours, method, kcal, protein, servings, tags,
        source_name, source_url, image_url, created_by
      ) values (
        ${name}, ${recipe.minutes ?? null}, ${recipe.marinate_hours ?? null},
        ${JSON.stringify(method)}, ${recipe.kcal ?? null}, ${recipe.protein_g ?? null},
        ${recipe.servings ?? null}, ${tags}, ${recipe.source_name || null}, ${recipe.source_url || null},
        ${imageUrl}, ${personId}
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
  return { id, created, name };
}

export async function importHomeBaseJson(sql, personId, body) {
  const { recipes, ingredients, mealPlan, prep, weekStart, weekEnd } = normalizeImportPayload(body);

  const ingredientsByRecipe = {};
  for (const ing of ingredients) {
    const key = ing.recipe_name;
    if (!key) continue;
    if (!ingredientsByRecipe[key]) ingredientsByRecipe[key] = [];
    ingredientsByRecipe[key].push(ing);
  }

  const customSlots = new Set(['snack_am', 'snack_pm', 'before_sleep', 'lunch_charu']);
  for (const row of mealPlan) {
    if (row.slot) customSlots.add(mealSlotKey(row));
  }

  if (customSlots.size) {
    const existingSettings = await sql`select custom_slots from household_settings where id = true`;
    const merged = [...new Set([...(existingSettings[0]?.custom_slots || []), ...customSlots])];
    await sql`update household_settings set custom_slots = ${merged} where id = true`;
  }

  const recipeIds = {};
  let created = 0;
  let updated = 0;
  const imported = [];

  for (const recipe of recipes) {
    const result = await upsertRecipe(sql, recipe, ingredientsByRecipe[recipe.recipe_name] || [], personId);
    recipeIds[recipe.recipe_name] = result.id;
    imported.push({ id: result.id, name: result.name, created: result.created });
    if (result.created) created++;
    else updated++;
  }

  let meals = 0;
  if (mealPlan.length && weekStart && weekEnd) {
    await sql`
      delete from meal_plan_slots
      where plan_date >= ${weekStart}::date and plan_date <= ${weekEnd}::date
    `;
  }

  for (const row of mealPlan) {
    const slotKey = mealSlotKey(row);
    const recipeId = recipeIds[row.recipe_name] || null;
    const adhocName = recipeId ? null : (row.recipe_name || row.adhoc_name);
    if (!recipeId && !adhocName) continue;

    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, updated_by)
      values (
        ${row.date}, ${slotKey}, ${recipeId}, ${adhocName},
        ${row.kcal ?? 0}, ${row.protein_g ?? row.protein ?? 0}, ${personId}
      )
      on conflict (plan_date, slot_key) do update
      set recipe_id = excluded.recipe_id,
          adhoc_name = excluded.adhoc_name,
          kcal = excluded.kcal,
          protein = excluded.protein,
          updated_by = ${personId},
          updated_at = now()
    `;
    meals++;
  }

  let prepTasks = 0;
  if (prep.length) {
    const people = await sql`select id, lower(name) as key from people`;
    for (const p of prep) {
      const personRow = p.person && p.person !== 'both'
        ? people.find((x) => x.key === p.person)
        : null;
      const title = String(p.task || '').startsWith('Prep') ? p.task : `Prep · ${p.task}`;
      await sql`
        insert into calendar_events (
          event_date, start_time, end_time, title, person_id, is_prep, source
        ) values (
          ${p.date}, ${p.time || '18:00'}, null, ${title},
          ${personRow?.id || null}, true, 'manual'
        )
      `;
      prepTasks++;
    }
  }

  return { created, updated, meals, prepTasks, imported };
}
