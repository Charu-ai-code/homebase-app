import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { invalidateCache } from '../../_lib/ai.js';
import { syncShoppingFromMeals, startOfWeek, toDateStr } from '../../_lib/household.js';

const STATUSES = new Set(['planned', 'eaten', 'skipped']);

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'PATCH') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJson(req);
  const { planDate, slotKey, adhocName, kcal, protein, recipeId, status } = body;
  if (!planDate || !slotKey) {
    json(res, 400, { error: 'planDate and slotKey required' });
    return;
  }

  const sql = getDb();

  // Status-only update (ate / skipped / reset)
  if (status !== undefined && recipeId === undefined && adhocName === undefined && kcal === undefined && protein === undefined) {
    if (!STATUSES.has(status)) {
      json(res, 400, { error: 'status must be planned, eaten, or skipped' });
      return;
    }
    const existing = await sql`
      select id from meal_plan_slots
      where plan_date = ${planDate}::date and slot_key = ${slotKey}
    `;
    if (!existing.length) {
      json(res, 404, { error: 'No meal in that slot yet — add one first' });
      return;
    }
    await sql`
      update meal_plan_slots
      set log_status = ${status},
          updated_by = ${auth.person.id},
          updated_at = now()
      where plan_date = ${planDate}::date and slot_key = ${slotKey}
    `;
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true, status });
    return;
  }

  if (recipeId) {
    const recipes = await sql`select id, name, kcal, protein from recipes where id = ${recipeId}`;
    if (!recipes.length) {
      json(res, 404, { error: 'Recipe not found' });
      return;
    }
    const r = recipes[0];
    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, log_status, updated_by)
      values (${planDate}, ${slotKey}, ${r.id}, null, ${kcal ?? r.kcal ?? 0}, ${protein ?? r.protein ?? 0}, 'planned', ${auth.person.id})
      on conflict (plan_date, slot_key) do update
      set recipe_id = excluded.recipe_id,
          adhoc_name = null,
          kcal = excluded.kcal,
          protein = excluded.protein,
          log_status = 'planned',
          updated_by = ${auth.person.id},
          updated_at = now()
    `;
  } else {
    await sql`
      insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, log_status, updated_by)
      values (${planDate}, ${slotKey}, null, ${adhocName || '—'}, ${kcal ?? 0}, ${protein ?? 0}, 'planned', ${auth.person.id})
      on conflict (plan_date, slot_key) do update
      set adhoc_name = excluded.adhoc_name,
          recipe_id = null,
          kcal = excluded.kcal,
          protein = excluded.protein,
          log_status = 'planned',
          updated_by = ${auth.person.id},
          updated_at = now()
    `;
  }

  const weekMon = toDateStr(startOfWeek(new Date(planDate + 'T12:00:00')));
  await sql`delete from ai_insight_cache where cache_key = ${'shopping-sync:' + weekMon}`;
  await syncShoppingFromMeals(sql, weekMon);

  await invalidateCache('mealplan');
  await invalidateCache('dashboard-priority');
  json(res, 200, { ok: true });
}
