import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { estimateRecipe, chat, recipeImageUrl } from '../../_lib/ai.js';

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* ignore */ }
    }
    return null;
  }
}

async function saveEstimate(sql, personId, estimate) {
  const imageUrl = estimate.imageUrl || recipeImageUrl(estimate.name);
  const existing = await sql`select id from recipes where lower(name) = ${String(estimate.name).toLowerCase()} limit 1`;
  let recipeId;
  if (existing.length) {
    recipeId = existing[0].id;
    await sql`
      update recipes set
        minutes = ${estimate.minutes ?? null},
        method = ${JSON.stringify(estimate.method || [])},
        kcal = ${estimate.kcal ?? null},
        protein = ${estimate.protein ?? null},
        servings = ${estimate.servings || null},
        tags = ${estimate.tags || []},
        image_url = coalesce(image_url, ${imageUrl}),
        updated_at = now()
      where id = ${recipeId}
    `;
  } else {
    const rows = await sql`
      insert into recipes (name, minutes, method, kcal, protein, servings, tags, image_url, created_by)
      values (
        ${estimate.name}, ${estimate.minutes ?? null}, ${JSON.stringify(estimate.method || [])},
        ${estimate.kcal ?? null}, ${estimate.protein ?? null}, ${estimate.servings || null},
        ${estimate.tags || []}, ${imageUrl}, ${personId}
      )
      returning id
    `;
    recipeId = rows[0].id;
  }

  const ingredients = Array.isArray(estimate.ingredients) ? estimate.ingredients : [];
  if (ingredients.length) {
    await sql`delete from recipe_ingredients where recipe_id = ${recipeId}`;
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      if (!ing?.name) continue;
      await sql`
        insert into recipe_ingredients (recipe_id, sort_order, name, qty, aisle, note)
        values (${recipeId}, ${i}, ${ing.name}, ${ing.qty || null}, ${ing.aisle || 'Other'}, ${ing.note || null})
      `;
    }
  }

  return { id: recipeId, ...estimate, imageUrl };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const body = await readJson(req);
    const sql = getDb();

    // Auto-invent several recipes and save them to the book
    if (body.invent) {
      const count = Math.min(6, Math.max(1, Number(body.count) || 3));
      const existing = await sql`select name from recipes order by name`;
      const raw = await chat(
        `You invent home-cook recipes. Return ONLY valid JSON: { "recipes": [ { "name", "kcal", "protein", "minutes", "servings", "tags", "method", "ingredients":[{"name","qty","aisle"}] } ] }. Invent exactly ${count} distinct dishes (Indian + easy weeknight). Do not reuse these names: ${(existing || []).map((r) => r.name).join(', ') || 'none'}.`,
        JSON.stringify({ count, style: 'household weeknight cooking for two' }),
        { jsonMode: true },
      );
      const parsed = parseJson(raw) || {};
      const list = Array.isArray(parsed.recipes) ? parsed.recipes.slice(0, count) : [];
      const saved = [];
      for (const dish of list) {
        if (!dish?.name) continue;
        const estimate = {
          name: dish.name,
          kcal: Number(dish.kcal) || 400,
          protein: Number(dish.protein) || 20,
          minutes: Number(dish.minutes) || 30,
          servings: dish.servings || '2',
          tags: Array.isArray(dish.tags) ? dish.tags : ['dinner'],
          method: Array.isArray(dish.method) ? dish.method : ['Prep', 'Cook', 'Serve'],
          ingredients: Array.isArray(dish.ingredients) ? dish.ingredients : [],
          imageUrl: recipeImageUrl(dish.name),
        };
        saved.push(await saveEstimate(sql, auth.person.id, estimate));
      }
      json(res, 200, { recipes: saved });
      return;
    }

    const name = String(body.name || '').trim();
    if (!name) {
      json(res, 400, { error: 'Recipe name required' });
      return;
    }
    const estimate = await estimateRecipe(name, {
      notes: body.notes || '',
      ingredientsHint: body.ingredientsHint || '',
    });

    // Optionally persist immediately
    if (body.save) {
      const recipe = await saveEstimate(sql, auth.person.id, estimate);
      json(res, 200, { estimate, recipe });
      return;
    }

    json(res, 200, { estimate });
  } catch (err) {
    console.error('recipe estimate error', err);
    json(res, 500, { error: err.message || 'AI estimate failed' });
  }
}
