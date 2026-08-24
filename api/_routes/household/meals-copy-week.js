import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { invalidateCache } from '../../_lib/ai.js';
import { syncShoppingFromMeals } from '../../_lib/household.js';

function toDateStr(d) {
  if (d == null) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function shiftDateStr(yyyyMmDd, days) {
  const d = new Date(`${yyyyMmDd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
    const fromWeekStart = body.fromWeekStart;
    if (!fromWeekStart || !/^\d{4}-\d{2}-\d{2}$/.test(fromWeekStart)) {
      json(res, 400, { error: 'fromWeekStart required (YYYY-MM-DD)' });
      return;
    }

    const sql = getDb();
    const weekEnd = shiftDateStr(fromWeekStart, 6);
    const toWeekStart = shiftDateStr(fromWeekStart, 7);

    const rows = await sql`
      select plan_date, slot_key, recipe_id, adhoc_name, kcal, protein
      from meal_plan_slots
      where plan_date >= ${fromWeekStart}::date and plan_date <= ${weekEnd}::date
    `;

    const toCopy = rows.filter((row) => {
      if (row.recipe_id) return true;
      const name = row.adhoc_name?.trim();
      return name && name !== '—';
    });

    if (!toCopy.length) {
      json(res, 400, { error: 'Nothing to copy — this week has no meals yet' });
      return;
    }

    for (const row of toCopy) {
      const planDate = shiftDateStr(toDateStr(row.plan_date), 7);
      await sql`
        insert into meal_plan_slots (plan_date, slot_key, recipe_id, adhoc_name, kcal, protein, updated_by)
        values (
          ${planDate}, ${row.slot_key}, ${row.recipe_id}, ${row.adhoc_name},
          ${row.kcal ?? 0}, ${row.protein ?? 0}, ${auth.person.id}
        )
        on conflict (plan_date, slot_key) do update
        set recipe_id = excluded.recipe_id,
            adhoc_name = excluded.adhoc_name,
            kcal = excluded.kcal,
            protein = excluded.protein,
            updated_by = ${auth.person.id},
            updated_at = now()
      `;
    }

    await invalidateCache('mealplan');
    await sql`delete from ai_insight_cache where cache_key = ${'shopping-sync:' + toWeekStart}`;
    await syncShoppingFromMeals(sql, toWeekStart);
    json(res, 200, {
      ok: true,
      copied: toCopy.length,
      fromWeekStart,
      toWeekStart,
    });
  } catch (err) {
    console.error('meals copy week error', err);
    json(res, 500, { error: err.message || 'Copy failed' });
  }
}
