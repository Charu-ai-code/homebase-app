import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import {
  startOfWeek,
  toDateStr,
  ensureShopCategory,
  loadShopCategories,
  normalizeShopCategory,
  autoPriorityForNeedBy,
  recomputeShoppingItemSchedule,
  computeAutoScheduleForItem,
} from '../../_lib/household.js';

const VALID_PRIORITIES = new Set(['high', 'normal', 'low']);

function resolveWeekStart(weekStart) {
  if (weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return weekStart;
  return toDateStr(startOfWeek(new Date()));
}

function normalizePriority(value) {
  const p = String(value || 'normal').toLowerCase();
  return VALID_PRIORITIES.has(p) ? p : 'normal';
}

function normalizeNeedBy(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function shapeItem(row) {
  if (!row) return null;
  return {
    needBy: row.need_by ? toDateStr(row.need_by) : null,
    needByOverride: !!row.need_by_override,
    priority: row.priority || 'normal',
    priorityOverride: !!row.priority_override,
    manualOverride: !!row.manual_override,
  };
}

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const {
      id, checked, name, qty, aisle, note, store,
      needBy, priority, resetAutoSchedule, weekStart,
    } = body;
    if (!id) {
      json(res, 400, { error: 'Item id required' });
      return;
    }

    const onlyChecked = typeof checked === 'boolean'
      && name === undefined && qty === undefined && aisle === undefined
      && note === undefined && store === undefined && needBy === undefined
      && priority === undefined && !resetAutoSchedule;
    if (onlyChecked) {
      await sql`update shopping_list_items set checked = ${checked} where id = ${id}`;
      json(res, 200, { ok: true });
      return;
    }

    const rows = await sql`
      select id, name, qty, aisle, note, store, checked, source, week_start,
             need_by, need_by_override, priority, priority_override, manual_override
      from shopping_list_items where id = ${id}
    `;
    if (!rows[0]) {
      json(res, 404, { error: 'Item not found' });
      return;
    }
    const cur = rows[0];

    if (resetAutoSchedule) {
      const week = resolveWeekStart(weekStart || toDateStr(cur.week_start));
      await recomputeShoppingItemSchedule(sql, id, week);
      const updated = await sql`
        select id, name, qty, aisle, note, store, checked, source, week_start,
               need_by, need_by_override, priority, priority_override, manual_override
        from shopping_list_items where id = ${id}
      `;
      json(res, 200, { ok: true, item: shapeItem(updated[0]), categories: await loadShopCategories(sql) });
      return;
    }

    const nextName = name !== undefined ? String(name).trim() : cur.name;
    if (!nextName) {
      json(res, 400, { error: 'Name required' });
      return;
    }
    const nextQty = qty !== undefined ? (qty || '1') : cur.qty;
    const nextAisle = aisle !== undefined
      ? await ensureShopCategory(sql, aisle || 'Other')
      : cur.aisle;
    const nextNote = note !== undefined ? note : cur.note;
    const nextStore = store !== undefined ? (String(store).trim() || null) : cur.store;
    const nextChecked = typeof checked === 'boolean' ? checked : cur.checked;

    const contentEdited = name !== undefined || qty !== undefined || aisle !== undefined
      || note !== undefined || store !== undefined;
    const nextManualOverride = contentEdited ? true : !!cur.manual_override;

    let nextPriority = cur.priority || 'normal';
    let nextPriorityOverride = !!cur.priority_override;
    let nextNeedBy = cur.need_by ? toDateStr(cur.need_by) : null;
    let nextNeedByOverride = !!cur.need_by_override;
    if (needBy !== undefined) {
      const parsed = normalizeNeedBy(needBy);
      if (parsed) {
        nextNeedBy = parsed;
        nextNeedByOverride = true;
      } else if (cur.source === 'meal_plan') {
        const week = resolveWeekStart(weekStart || toDateStr(cur.week_start));
        const auto = await computeAutoScheduleForItem(sql, id, week);
        nextNeedBy = auto.needBy;
        nextNeedByOverride = false;
        if (priority === undefined && !cur.priority_override) {
          nextPriority = auto.priority;
          nextPriorityOverride = false;
        }
      } else {
        nextNeedBy = null;
        nextNeedByOverride = false;
      }
    }

    if (priority !== undefined) {
      nextPriority = normalizePriority(priority);
      nextPriorityOverride = true;
    } else if (needBy !== undefined && nextNeedBy && !nextNeedByOverride && !cur.priority_override) {
      nextPriority = autoPriorityForNeedBy(nextNeedBy);
      nextPriorityOverride = false;
    }

    await sql`
      update shopping_list_items
      set name = ${nextName},
          qty = ${nextQty},
          aisle = ${nextAisle},
          note = ${nextNote},
          store = ${nextStore},
          checked = ${nextChecked},
          need_by = ${nextNeedBy},
          need_by_override = ${nextNeedByOverride},
          priority = ${nextPriority},
          priority_override = ${nextPriorityOverride},
          manual_override = ${nextManualOverride}
      where id = ${id}
    `;
    json(res, 200, {
      ok: true,
      item: {
        needBy: nextNeedBy,
        needByOverride: nextNeedByOverride,
        priority: nextPriority,
        priorityOverride: nextPriorityOverride,
        manualOverride: nextManualOverride,
      },
      categories: await loadShopCategories(sql),
    });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJson(req);

    if (body.addCategory) {
      const name = normalizeShopCategory(body.name);
      if (name.length < 2) {
        json(res, 400, { error: 'Category name required' });
        return;
      }
      await ensureShopCategory(sql, name);
      json(res, 201, { category: name, categories: await loadShopCategories(sql) });
      return;
    }

    const { name, qty, aisle, note, store, needBy, priority, weekStart } = body;
    if (!name) {
      json(res, 400, { error: 'Name required' });
      return;
    }
    const week = resolveWeekStart(weekStart);
    const nextAisle = await ensureShopCategory(sql, aisle || 'Other');
    const parsedNeedBy = normalizeNeedBy(needBy);
    const nextPriority = normalizePriority(priority);
    const rows = await sql`
      insert into shopping_list_items (
        name, qty, aisle, note, store, need_by, need_by_override,
        priority, priority_override, added_by, week_start, source
      )
      values (
        ${name},
        ${qty || '1'},
        ${nextAisle},
        ${note || 'Added manually'},
        ${store ? String(store).trim() : null},
        ${parsedNeedBy},
        ${!!parsedNeedBy},
        ${nextPriority},
        ${priority !== undefined && priority !== null && priority !== ''},
        ${auth.person.id},
        ${week}::date,
        'manual'
      )
      returning id, need_by, priority
    `;
    json(res, 201, {
      id: rows[0].id,
      weekStart: week,
      needBy: rows[0].need_by ? toDateStr(rows[0].need_by) : null,
      priority: rows[0].priority || 'normal',
      categories: await loadShopCategories(sql),
    });
    return;
  }

  if (req.method === 'DELETE') {
    const { id, clearChecked, weekStart } = await readJson(req);
    if (clearChecked) {
      const week = resolveWeekStart(weekStart);
      await sql`
        delete from shopping_list_items
        where checked = true and week_start = ${week}::date
      `;
      json(res, 200, { ok: true });
      return;
    }
    if (!id) {
      json(res, 400, { error: 'Item id required' });
      return;
    }
    await sql`delete from shopping_list_items where id = ${id}`;
    json(res, 200, { ok: true });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
