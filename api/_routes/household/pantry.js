import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { startOfWeek, toDateStr, syncShoppingFromMeals, ensureShopCategory, loadShopCategories } from '../../_lib/household.js';

function resolveWeekStart(weekStart) {
  if (weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return weekStart;
  return toDateStr(startOfWeek(new Date()));
}

async function refreshWeekShopping(sql, weekStart) {
  const week = resolveWeekStart(weekStart);
  await sql`delete from ai_insight_cache where cache_key = ${'shopping-sync:' + week}`;
  await syncShoppingFromMeals(sql, week);
  return week;
}

function guessAisle(name) {
  const n = String(name || '').toLowerCase();
  if (/chili|chilli|ginger|onion|garlic|spinach|cilantro|lemon|lime|tomato|produce/.test(n)) return 'Produce';
  if (/chicken|paneer|yogurt|yoghurt|milk|egg|cheese|meat|dairy/.test(n)) return 'Meat + dairy';
  if (/masala|turmeric|cumin|coriander|spice|chili powder|garam/.test(n)) return 'Spices';
  if (/frozen|ice/.test(n)) return 'Frozen';
  return 'Pantry';
}

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`
      select id, name, aisle, note, store
      from pantry_items
      order by lower(name)
    `;
    json(res, 200, { items: rows });
    return;
  }

  if (req.method === 'POST') {
    const { name, aisle, note, store, weekStart } = await readJson(req);
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      json(res, 400, { error: 'Name required' });
      return;
    }
    const nextAisle = await ensureShopCategory(sql, aisle || guessAisle(trimmed));
    const nextStore = store ? String(store).trim() : null;
    try {
      const rows = await sql`
        insert into pantry_items (name, aisle, note, store)
        values (${trimmed}, ${nextAisle}, ${note || null}, ${nextStore})
        returning id, name, aisle, note, store
      `;
      await refreshWeekShopping(sql, weekStart);
      json(res, 201, { item: rows[0], categories: await loadShopCategories(sql) });
    } catch (err) {
      if (err?.code === '23505') {
        json(res, 409, { error: 'Already on the at-home list' });
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === 'PATCH') {
    const { id, name, aisle, note, store, weekStart } = await readJson(req);
    if (!id) {
      json(res, 400, { error: 'Item id required' });
      return;
    }
    const rows = await sql`select id, name, aisle, note, store from pantry_items where id = ${id}`;
    if (!rows[0]) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    const cur = rows[0];
    const nextName = name !== undefined ? String(name).trim() : cur.name;
    if (!nextName) {
      json(res, 400, { error: 'Name required' });
      return;
    }
    const nextAisle = aisle !== undefined
      ? await ensureShopCategory(sql, aisle || 'Pantry')
      : cur.aisle;
    const nextNote = note !== undefined ? note : cur.note;
    const nextStore = store !== undefined ? (String(store).trim() || null) : cur.store;
    try {
      const updated = await sql`
        update pantry_items
        set name = ${nextName}, aisle = ${nextAisle}, note = ${nextNote}, store = ${nextStore}
        where id = ${id}
        returning id, name, aisle, note, store
      `;
      await refreshWeekShopping(sql, weekStart);
      json(res, 200, { item: updated[0], categories: await loadShopCategories(sql) });
    } catch (err) {
      if (err?.code === '23505') {
        json(res, 409, { error: 'Another at-home item already has that name' });
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === 'DELETE') {
    const body = await readJson(req);
    const { id, moveToShopping, weekStart } = body;
    if (!id) {
      json(res, 400, { error: 'Item id required' });
      return;
    }
    const rows = await sql`select id, name, aisle, note, store from pantry_items where id = ${id}`;
    if (!rows[0]) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    const item = rows[0];
    await sql`delete from pantry_items where id = ${id}`;

    let shoppingId = null;
    const week = resolveWeekStart(weekStart);
    await refreshWeekShopping(sql, week);

    if (moveToShopping) {
      const existing = await sql`
        select id from shopping_list_items
        where week_start = ${week}::date
          and lower(trim(name)) = lower(trim(${item.name}))
        limit 1
      `;
      if (existing.length) {
        shoppingId = existing[0].id;
        await sql`
          update shopping_list_items
          set checked = false,
              store = coalesce(store, ${item.store || null}),
              note = case
                when note is null or note = '' then 'Was at home — ran out'
                when note ilike '%ran out%' then note
                else note || ' · ran out'
              end
          where id = ${shoppingId}
        `;
      } else {
        const inserted = await sql`
          insert into shopping_list_items (name, qty, aisle, note, store, added_by, week_start, source)
          values (
            ${item.name},
            '1',
            ${item.aisle || 'Other'},
            ${'Was at home — ran out'},
            ${item.store || null},
            ${auth.person.id},
            ${week}::date,
            'manual'
          )
          returning id
        `;
        shoppingId = inserted[0].id;
      }
    }

    json(res, 200, { ok: true, shoppingId, moved: !!moveToShopping });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
