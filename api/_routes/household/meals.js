import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { invalidateCache } from '../../_lib/ai.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'PATCH') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { planDate, slotKey, adhocName, kcal, protein, recipeId } = await readJson(req);
  if (!planDate || !slotKey) {
    json(res, 400, { error: 'planDate and slotKey required' });
    return;
  }

  const sql = getDb();

  if (recipeId) {
    const recipes = await sql`select id, name, kcal, protein from recipes where id = ${recipeId}`;
    if (!recipes.length) {
      json(res, 404, { error: 'Recipe not found' });
      return;
    }
    const r = recipes[0];
    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, updated_by)
      values (${planDate}, ${slotKey}, ${r.id}, null, ${kcal ?? r.kcal ?? 0}, ${protein ?? r.protein ?? 0}, ${auth.person.id})
      on conflict (plan_date, slot_key) do update
      set recipe_id = excluded.recipe_id,
          adhoc_name = null,
          kcal = excluded.kcal,
          protein = excluded.protein,
          updated_by = ${auth.person.id},
          updated_at = now()
    `;
  } else {
    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, updated_by)
      values (${planDate}, ${slotKey}, null, ${adhocName || '—'}, ${kcal ?? 0}, ${protein ?? 0}, ${auth.person.id})
      on conflict (plan_date, slot_key) do update
      set adhoc_name = excluded.adhoc_name,
          kcal = excluded.kcal,
          protein = excluded.protein,
          updated_by = ${auth.person.id},
          updated_at = now()
    `;
  }

  await invalidateCache('mealplan');
  await invalidateCache('dashboard-priority');
  json(res, 200, { ok: true });
}
