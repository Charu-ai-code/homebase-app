import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';

function shapeRecipe(row, ingredients = []) {
  let method = row.method;
  if (typeof method === 'string') {
    try { method = JSON.parse(method); } catch { method = [method]; }
  }
  if (!Array.isArray(method)) method = [];

  return {
    id: row.id,
    name: row.name,
    minutes: row.minutes,
    marinateHours: row.marinate_hours != null ? Number(row.marinate_hours) : null,
    method,
    kcal: row.kcal,
    protein: row.protein,
    servings: row.servings,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    imageUrl: row.image_url || null,
    tags: row.tags || [],
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      aisle: i.aisle,
      note: i.note,
      sortOrder: i.sort_order,
    })),
  };
}

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'GET') {
    const id = req.query?.id;
    if (id) {
      const rows = await sql`select * from recipes where id = ${id}`;
      if (!rows.length) {
        json(res, 404, { error: 'Recipe not found' });
        return;
      }
      const ingredients = await sql`
        select * from recipe_ingredients
        where recipe_id = ${id}
        order by sort_order, name
      `;
      json(res, 200, { recipe: shapeRecipe(rows[0], ingredients) });
      return;
    }

    const rows = await sql`
      select r.*,
        (select count(*)::int from recipe_ingredients ri where ri.recipe_id = r.id) as ingredient_count
      from recipes r
      order by r.name
    `;
    json(res, 200, {
      recipes: rows.map((r) => ({
        ...shapeRecipe(r),
        ingredientCount: r.ingredient_count,
      })),
    });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const { name, minutes, kcal, protein, method, servings, tags, ingredients, marinateHours, imageUrl } = body;
    if (!name) {
      json(res, 400, { error: 'Name required' });
      return;
    }

    const rows = await sql`
      insert into recipes (name, minutes, marinate_hours, method, kcal, protein, servings, tags, image_url, created_by)
      values (
        ${name},
        ${minutes ?? null},
        ${marinateHours ?? null},
        ${JSON.stringify(method || [])},
        ${kcal ?? null},
        ${protein ?? null},
        ${servings || null},
        ${tags || []},
        ${imageUrl || null},
        ${auth.person.id}
      )
      returning *
    `;

    const recipeId = rows[0].id;
    const ingList = Array.isArray(ingredients) ? ingredients : [];
    for (let i = 0; i < ingList.length; i++) {
      const ing = ingList[i];
      if (!ing?.name) continue;
      await sql`
        insert into recipe_ingredients (recipe_id, sort_order, name, qty, aisle, note)
        values (${recipeId}, ${i}, ${ing.name}, ${ing.qty || null}, ${ing.aisle || 'Other'}, ${ing.note || null})
      `;
    }

    const savedIngredients = await sql`
      select * from recipe_ingredients where recipe_id = ${recipeId} order by sort_order
    `;
    json(res, 201, { recipe: shapeRecipe(rows[0], savedIngredients) });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const { id, name, minutes, kcal, protein, method, servings, tags, ingredients, marinateHours, imageUrl } = body;
    if (!id) {
      json(res, 400, { error: 'Recipe id required' });
      return;
    }

    const existing = await sql`select id from recipes where id = ${id}`;
    if (!existing.length) {
      json(res, 404, { error: 'Recipe not found' });
      return;
    }

    await sql`
      update recipes set
        name = coalesce(${name || null}, name),
        minutes = coalesce(${minutes ?? null}, minutes),
        marinate_hours = coalesce(${marinateHours ?? null}, marinate_hours),
        method = coalesce(${method ? JSON.stringify(method) : null}, method),
        kcal = coalesce(${kcal ?? null}, kcal),
        protein = coalesce(${protein ?? null}, protein),
        servings = coalesce(${servings || null}, servings),
        tags = coalesce(${tags || null}, tags),
        image_url = coalesce(${imageUrl || null}, image_url),
        updated_at = now()
      where id = ${id}
    `;

    if (Array.isArray(ingredients)) {
      await sql`delete from recipe_ingredients where recipe_id = ${id}`;
      for (let i = 0; i < ingredients.length; i++) {
        const ing = ingredients[i];
        if (!ing?.name) continue;
        await sql`
          insert into recipe_ingredients (recipe_id, sort_order, name, qty, aisle, note)
          values (${id}, ${i}, ${ing.name}, ${ing.qty || null}, ${ing.aisle || 'Other'}, ${ing.note || null})
        `;
      }
    }

    const rows = await sql`select * from recipes where id = ${id}`;
    const savedIngredients = await sql`
      select * from recipe_ingredients where recipe_id = ${id} order by sort_order
    `;
    json(res, 200, { recipe: shapeRecipe(rows[0], savedIngredients) });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
