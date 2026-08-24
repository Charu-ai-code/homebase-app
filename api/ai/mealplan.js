import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { loadHouseholdData } from '../_lib/household.js';
import { chat, getCachedInsight, setCachedInsight, recipeImageUrl, invalidateCache } from '../_lib/ai.js';

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

async function upsertRecipeFromPlan(sql, personId, dish) {
  const name = String(dish.name || '').trim();
  if (!name) return null;

  const existing = await sql`select id, kcal, protein from recipes where lower(name) = ${name.toLowerCase()} limit 1`;
  const imageUrl = dish.imageUrl || recipeImageUrl(name);
  const method = Array.isArray(dish.method) ? dish.method : ['Prep', 'Cook', 'Serve'];
  const tags = Array.isArray(dish.tags) && dish.tags.length ? dish.tags : ['dinner'];
  const kcal = Number(dish.kcal) || 450;
  const protein = Number(dish.protein) || 25;
  const minutes = Number(dish.minutes) || 35;
  const servings = dish.servings || '2–3';

  let recipeId;
  if (existing.length) {
    recipeId = existing[0].id;
    await sql`
      update recipes set
        minutes = coalesce(${minutes}, minutes),
        method = ${JSON.stringify(method)},
        kcal = ${kcal},
        protein = ${protein},
        servings = coalesce(${servings}, servings),
        tags = ${tags},
        image_url = coalesce(image_url, ${imageUrl}),
        updated_at = now()
      where id = ${recipeId}
    `;
  } else {
    const rows = await sql`
      insert into recipes (name, minutes, method, kcal, protein, servings, tags, image_url, created_by)
      values (
        ${name}, ${minutes}, ${JSON.stringify(method)},
        ${kcal}, ${protein}, ${servings}, ${tags}, ${imageUrl}, ${personId}
      )
      returning id
    `;
    recipeId = rows[0].id;
  }

  const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients : [];
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

  return { recipeId, name, kcal, protein, created: !existing.length };
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
    const force = !!body.force;
    const apply = body.apply !== false; // default: invent + assign recipes
    const ref = body.weekStart
      ? new Date(body.weekStart + 'T12:00:00')
      : new Date();

    const data = await loadHouseholdData(ref);
    const weekStart = data.weekStart || data.week[0]?.dateStr || '';
    const cacheKey = `mealplan-week:${weekStart}`;

    // Soft insight-only path (prefetch) when apply is explicitly false
    if (!apply && !force) {
      const cached = await getCachedInsight(cacheKey);
      if (cached) {
        json(res, 200, { insight: cached, cached: true, applied: false });
        return;
      }
    }

    const sql = getDb();
    const cookbook = await sql`select id, name, kcal, protein, tags from recipes order by name`;

    if (!apply) {
      const prompt = JSON.stringify({
        week: data.week.map((d) => ({
          day: d.full,
          meals: d.meals,
          dinner: d.dinner,
          prep: d.prep,
        })),
        targets: {
          charu: data.people.charu?.calorieTarget,
          shreya: data.people.shreya?.calorieTarget,
        },
        proteinFloor: data.proteinFloor,
        whoop: data.whoop,
      });
      const insight = await chat(
        'You are HomeBase meal-planning AI for a household. Comment on leftover reuse, calorie balance for Charu and Shreya, and realistic prep on low-recovery days. Suggest concrete lunch/dinner swaps if useful. Write 2-3 sentences, no bullet points.',
        prompt,
      );
      await setCachedInsight(cacheKey, insight);
      json(res, 200, { insight, cached: false, applied: false });
      return;
    }

    const planPrompt = JSON.stringify({
      weekStart,
      days: data.week.map((d) => ({
        date: d.dateStr,
        label: d.full,
        busy: d.who,
        currentDinner: d.dinner?.name,
        recoveryHint: data.whoop,
      })),
      existingRecipes: cookbook.map((r) => r.name),
      targets: {
        charuKcal: data.people.charu?.calorieTarget,
        shreyaKcal: data.people.shreya?.calorieTarget,
        proteinFloorG: data.proteinFloor,
      },
      cuisine: 'Indian + easy weeknight (bowls, one-pot, sheet pan). Prefer vegetarian a few nights.',
    });

    const raw = await chat(
      `You are HomeBase meal planner. Return ONLY valid JSON:
{
  "insight": "2-3 sentence summary of the plan",
  "dinners": [
    {
      "date": "YYYY-MM-DD",
      "name": "Dish name",
      "kcal": number,
      "protein": number,
      "minutes": number,
      "servings": "2-3",
      "tags": ["dinner"],
      "method": ["step1","step2","step3"],
      "ingredients": [{"name":"...","qty":"...","aisle":"Produce|Meat + dairy|Pantry|Frozen|Other"}]
    }
  ]
}
Rules: one dinner per day in the week; reuse existingRecipes by exact name when it fits; invent new dishes when needed; keep kcal near 450-650; include realistic ingredients (4-8); method 3-5 short steps.`,
      planPrompt,
      { jsonMode: true },
    );

    const parsed = parseJson(raw) || {};
    const dinners = Array.isArray(parsed.dinners) ? parsed.dinners : [];
    if (!dinners.length) {
      json(res, 500, { error: 'AI returned no dinners — try again' });
      return;
    }

    const applied = [];
    const createdRecipes = [];

    for (const dish of dinners) {
      const date = String(dish.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const saved = await upsertRecipeFromPlan(sql, auth.person.id, dish);
      if (!saved) continue;

      await sql`
        insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, updated_by)
        values (${date}, ${'dinner'}, ${saved.recipeId}, null, ${saved.kcal}, ${saved.protein}, ${auth.person.id})
        on conflict (plan_date, slot_key) do update
        set recipe_id = excluded.recipe_id,
            adhoc_name = null,
            kcal = excluded.kcal,
            protein = excluded.protein,
            updated_by = ${auth.person.id},
            updated_at = now()
      `;

      applied.push({ date, name: saved.name, recipeId: saved.recipeId });
      if (saved.created) createdRecipes.push(saved.name);
    }

    const insight = parsed.insight
      || `Planned ${applied.length} dinners` + (createdRecipes.length ? ` · added ${createdRecipes.length} new recipes to the book` : '');

    await setCachedInsight(cacheKey, insight);
    await invalidateCache('mealplan');

    json(res, 200, {
      insight,
      applied: true,
      dinners: applied,
      createdRecipes,
      cached: false,
    });
  } catch (err) {
    console.error('ai mealplan error', err);
    json(res, 500, {
      error: err.message || 'AI meal plan failed — check KIMI_API_KEY / DEEPSEEK_API_KEY',
    });
  }
}
