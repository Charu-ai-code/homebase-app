import { getDb } from '../_lib/db.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = { sun: 'SUN', mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT' };
const SLOT_KEYS = ['drink', 'breakfast', 'shake', 'lunch', 'snack', 'dinner', 'dessert'];
const SLOT_LABELS_BASE = {
  drink: 'MORNING DRINK',
  breakfast: 'BREAKFAST',
  shake: 'SHAKE',
  lunch: 'LUNCH',
  snack: 'SNACK',
  dinner: 'DINNER',
  dessert: 'DESSERT',
};

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toDateStr(d) {
  if (d == null) return '';
  // Neon DATE / date-only strings — never re-parse via local Date math
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  // DATE columns arrive as midnight-in-some-TZ instants; UTC ISO date is stable
  return x.toISOString().slice(0, 10);
}

function formatFullDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeToStr(t) {
  if (!t) return '00:00';
  const s = String(t);
  return s.slice(0, 5);
}

function personKeyFromId(peopleById, personId) {
  if (!personId) return 'shared';
  const p = peopleById[personId];
  return p ? p.key : 'shared';
}

export function getWeekRange(referenceDate = new Date()) {
  const start = startOfWeek(referenceDate);
  const end = addDays(start, 6);
  return { start, end, dates: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}

function itemKey(name, aisle) {
  return `${String(name || '').trim().toLowerCase()}|${aisle || 'Other'}`;
}

function summarizeQtys(parts) {
  const uniq = [...new Set(parts.map((p) => (p.qty || '').trim()).filter(Boolean))];
  if (!uniq.length) return '1';
  if (uniq.length === 1) return uniq[0];
  return uniq.join(' + ');
}

export const DEFAULT_SHOP_CATEGORIES = ['Produce', 'Meat + dairy', 'Pantry', 'Frozen', 'Bakery', 'Spices', 'Other'];

export function normalizeShopCategory(name) {
  return String(name || '').trim().replace(/\s+/g, ' ') || 'Other';
}

export async function loadShopCategories(sql) {
  const rows = await sql`
    select coalesce(custom_shop_categories, '{}') as cats
    from household_settings where id = true
  `;
  return [...new Set([...DEFAULT_SHOP_CATEGORIES, ...(rows[0]?.cats || [])])];
}

export async function ensureShopCategory(sql, aisle) {
  const name = normalizeShopCategory(aisle);
  const list = await loadShopCategories(sql);
  if (list.includes(name)) return name;
  await sql`
    update household_settings
    set custom_shop_categories = (
      select array(select distinct unnest(coalesce(custom_shop_categories, '{}') || ${[name]}::text[]))
    )
    where id = true
  `;
  return name;
}

export async function loadRecipeFirstDates(sql, weekStartStr, endStr) {
  const slotRows = await sql`
    select recipe_id, plan_date
    from meal_plan_slots
    where plan_date >= ${weekStartStr}::date
      and plan_date <= ${endStr}::date
      and recipe_id is not null
  `;
  const map = new Map();
  for (const row of slotRows) {
    const ds = toDateStr(row.plan_date);
    if (!ds) continue;
    const cur = map.get(row.recipe_id);
    if (!cur || ds < cur) map.set(row.recipe_id, ds);
  }
  return map;
}

export function earliestNeedByForRecipes(recipeIds, recipeFirstDate) {
  let min = null;
  for (const rid of recipeIds) {
    const d = recipeFirstDate.get(rid);
    if (d && (!min || d < min)) min = d;
  }
  return min;
}

export function autoPriorityForNeedBy(needBy, todayStr = toDateStr(new Date())) {
  if (!needBy) return 'normal';
  const need = new Date(`${needBy}T12:00:00`);
  const today = new Date(`${todayStr}T12:00:00`);
  const diffDays = Math.round((need - today) / 86400000);
  if (diffDays <= 1) return 'high';
  return 'normal';
}

export async function computeAutoScheduleForItem(sql, itemId, weekStartStr) {
  const endStr = toDateStr(addDays(new Date(`${weekStartStr}T12:00:00`), 6));
  const links = await sql`
    select recipe_id from shopping_item_recipes where shopping_item_id = ${itemId}
  `;
  const recipeFirstDate = await loadRecipeFirstDates(sql, weekStartStr, endStr);
  const needBy = earliestNeedByForRecipes(links.map((l) => l.recipe_id), recipeFirstDate);
  const priority = autoPriorityForNeedBy(needBy);
  return { needBy, priority };
}

export async function recomputeShoppingItemSchedule(sql, itemId, weekStartStr) {
  const { needBy, priority } = await computeAutoScheduleForItem(sql, itemId, weekStartStr);
  await sql`
    update shopping_list_items
    set need_by = ${needBy},
        need_by_override = false,
        priority = ${priority},
        priority_override = false
    where id = ${itemId}
  `;
  return { needBy, priority };
}

/** Rebuild meal_plan shopping rows for a week from recipe ingredients. Keeps manual items + checkmarks. */
export async function syncShoppingFromMeals(sql, weekStartStr) {
  if (!weekStartStr || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) return;
  const endStr = toDateStr(addDays(new Date(weekStartStr + 'T12:00:00'), 6));

  // Drop legacy unscoped rows once (pre–week-scoped shopping)
  await sql`delete from shopping_list_items where week_start is null`;

  const sigRows = await sql`
    select
      count(*)::int as n,
      coalesce(
        md5(string_agg(m.recipe_id::text || ':' || m.slot_key, ',' order by m.plan_date, m.slot_key, m.recipe_id::text)),
        ''
      ) as sig
    from meal_plan_slots m
    where m.plan_date >= ${weekStartStr}::date
      and m.plan_date <= ${endStr}::date
      and m.recipe_id is not null
  `;
  const pantrySigRows = await sql`
    select coalesce(md5(string_agg(lower(trim(name)), ',' order by lower(trim(name)))), '') as sig
    from pantry_items
  `;
  const mealSig = `${sigRows[0]?.n || 0}:${sigRows[0]?.sig || ''}:p${pantrySigRows[0]?.sig || ''}`;
  const cacheKey = `shopping-sync:${weekStartStr}`;
  const cached = await sql`select content from ai_insight_cache where cache_key = ${cacheKey}`;
  if (cached[0]?.content === mealSig) return;

  const mealRecipes = await sql`
    select distinct m.recipe_id, r.name as recipe_name
    from meal_plan_slots m
    join recipes r on r.id = m.recipe_id
    where m.plan_date >= ${weekStartStr}::date
      and m.plan_date <= ${endStr}::date
      and m.recipe_id is not null
  `;

  const recipeFirstDate = await loadRecipeFirstDates(sql, weekStartStr, endStr);
  const todayStr = toDateStr(new Date());

  const existing = await sql`
    select id, name, aisle, checked, need_by, need_by_override, priority, priority_override,
           store, qty, note, manual_override
    from shopping_list_items
    where week_start = ${weekStartStr}::date and source = 'meal_plan'
  `;
  const existingByKey = new Map(existing.map((e) => [itemKey(e.name, e.aisle), e]));

  const needed = new Map();
  if (mealRecipes.length) {
    const pantryRows = await sql`select lower(trim(name)) as name from pantry_items`;
    const pantryNames = new Set(pantryRows.map((p) => p.name));

    const recipeIds = mealRecipes.map((r) => r.recipe_id);
    const ingredients = await sql`
      select ri.recipe_id, r.name as recipe_name, ri.name, ri.qty, coalesce(nullif(ri.aisle, ''), 'Other') as aisle
      from recipe_ingredients ri
      join recipes r on r.id = ri.recipe_id
      where ri.recipe_id = any(${recipeIds}::uuid[])
    `;
    for (const ing of ingredients) {
      const name = String(ing.name || '').trim();
      if (!name) continue;
      if (pantryNames.has(name.toLowerCase())) continue;
      const aisle = ing.aisle || 'Other';
      const key = itemKey(name, aisle);
      if (!needed.has(key)) {
        needed.set(key, {
          name,
          aisle,
          qtys: [],
          recipes: new Set(),
          recipeIds: new Set(),
        });
      }
      const entry = needed.get(key);
      if (ing.qty) entry.qtys.push({ qty: String(ing.qty) });
      entry.recipes.add(ing.recipe_name);
      entry.recipeIds.add(ing.recipe_id);
    }
  }

  const seenIds = new Set();
  for (const entry of needed.values()) {
    const key = itemKey(entry.name, entry.aisle);
    const qty = summarizeQtys(entry.qtys);
    const recipeNames = [...entry.recipes].sort();
    const note = recipeNames.length > 1
      ? `Merged from ${recipeNames.join(', ')}`
      : `From ${recipeNames[0] || 'meal plan'}`;
    const autoNeedBy = earliestNeedByForRecipes([...entry.recipeIds], recipeFirstDate);
    const autoPriority = autoPriorityForNeedBy(autoNeedBy, todayStr);
    const prev = existingByKey.get(key);
    let id;
    if (prev) {
      id = prev.id;
      const nextNeedBy = prev.need_by_override ? prev.need_by : autoNeedBy;
      const nextPriority = prev.priority_override ? prev.priority : autoPriority;
      if (prev.manual_override) {
        // Keep user edits (name/qty/aisle/note/store); only refresh auto schedule fields.
        await sql`
          update shopping_list_items
          set need_by = ${nextNeedBy},
              priority = ${nextPriority}
          where id = ${id}
        `;
      } else {
        await sql`
          update shopping_list_items
          set name = ${entry.name},
              qty = ${qty},
              aisle = ${entry.aisle},
              note = ${note},
              need_by = ${nextNeedBy},
              priority = ${nextPriority}
          where id = ${id}
        `;
      }
      await sql`delete from shopping_item_recipes where shopping_item_id = ${id}`;
    } else {
      const rows = await sql`
        insert into shopping_list_items (
          name, qty, aisle, note, checked, week_start, source, need_by, priority
        )
        values (
          ${entry.name}, ${qty}, ${entry.aisle}, ${note}, false,
          ${weekStartStr}::date, 'meal_plan', ${autoNeedBy}, ${autoPriority}
        )
        returning id
      `;
      id = rows[0].id;
    }
    seenIds.add(id);
    for (const rid of entry.recipeIds) {
      await sql`
        insert into shopping_item_recipes (shopping_item_id, recipe_id, qty_contributed)
        values (${id}, ${rid}, ${qty})
        on conflict do nothing
      `;
    }
  }

  for (const row of existing) {
    if (seenIds.has(row.id)) continue;
    if (row.manual_override) {
      // Keep user-edited rows even if the meal plan no longer needs them.
      await sql`
        update shopping_list_items
        set source = 'manual',
            note = case
              when note is null or note = '' then 'Kept after meal plan change'
              when note ilike '%kept after%' then note
              else note || ' · kept after meal plan change'
            end
        where id = ${row.id}
      `;
      continue;
    }
    await sql`delete from shopping_list_items where id = ${row.id}`;
  }

  await sql`
    insert into ai_insight_cache (cache_key, content, generated_at)
    values (${cacheKey}, ${mealSig}, now())
    on conflict (cache_key) do update
    set content = excluded.content, generated_at = now()
  `;
}

export async function loadHouseholdData(referenceDate = new Date()) {
  const sql = getDb();
  const { start, end, dates } = getWeekRange(referenceDate);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  await syncShoppingFromMeals(sql, startStr);

  const peopleRows = await sql`select id, name, color, calorie_target from people order by name`;
  const settingsRows = await sql`
    select protein_floor_g,
           coalesce(custom_slots, '{}') as custom_slots,
           coalesce(custom_task_tags, '{}') as custom_task_tags,
           coalesce(custom_shop_categories, '{}') as custom_shop_categories
    from household_settings where id = true
  `;
  const customSlots = settingsRows[0]?.custom_slots || [];
  const DEFAULT_TASK_TAGS = ['cleaning', 'laundry', 'bills', 'car', 'errands'];
  const taskTags = [...new Set([...DEFAULT_TASK_TAGS, ...(settingsRows[0]?.custom_task_tags || [])])];
  const shopCategories = await loadShopCategories(sql);
  const activeSlots = [...SLOT_KEYS, ...customSlots.filter((s) => !SLOT_KEYS.includes(s))];
  const slotLabels = { ...SLOT_LABELS_BASE };
  for (const s of customSlots) {
    slotLabels[s] = s.replace(/_/g, ' ').toUpperCase();
  }
  const people = {};
  const peopleById = {};
  for (const p of peopleRows) {
    const key = p.name.toLowerCase();
    people[key] = {
      key,
      id: p.id,
      name: p.name,
      color: p.color,
      calorieTarget: p.calorie_target,
    };
    peopleById[p.id] = people[key];
  }

  const mealRows = await sql`
    select m.plan_date, m.slot_key, m.adhoc_name, m.kcal, m.protein, m.recipe_id,
           coalesce(m.log_status, 'planned') as log_status,
           r.name as recipe_name, r.minutes, r.method, r.marinate_hours
    from meal_plan_slots m
    left join recipes r on r.id = m.recipe_id
    where m.plan_date >= ${startStr} and m.plan_date <= ${endStr}
    order by m.plan_date, m.slot_key
  `;

  const eventRows = await sql`
    select id, event_date, start_time, end_time, title, person_id,
           is_prep, is_highlight, is_suggested, done, source
    from calendar_events
    where event_date >= ${startStr} and event_date <= ${endStr}
    order by event_date, start_time
  `;

  const taskRows = await sql`
    select id, title, person_id, due_date, tag, done, suggested, suggested_time, note
    from household_tasks
    order by created_at
  `;

  const shoppingRows = await sql`
    select s.id, s.name, s.qty, s.aisle, s.note, s.store, s.checked, s.source, s.week_start,
           s.need_by, s.need_by_override, s.priority, s.priority_override, s.manual_override
    from shopping_list_items s
    where s.week_start = ${startStr}::date
    order by s.aisle, s.name
  `;

  const recipeLinkRows = await sql`
    select sir.shopping_item_id, r.name as recipe_name, sir.qty_contributed
    from shopping_item_recipes sir
    join recipes r on r.id = sir.recipe_id
    join shopping_list_items s on s.id = sir.shopping_item_id
    where s.week_start = ${startStr}::date
  `;

  const pantryRows = await sql`
    select id, name, aisle, note, store
    from pantry_items
    order by lower(name)
  `;

  const todayStr = toDateStr(referenceDate);
  let todayIndex = dates.findIndex((d) => toDateStr(d) === todayStr);
  if (todayIndex < 0) todayIndex = 0;

  const mealsByDate = {};
  for (const m of mealRows) {
    const ds = toDateStr(m.plan_date);
    if (!ds) continue;
    if (!mealsByDate[ds]) mealsByDate[ds] = {};
    const method = m.method;
    mealsByDate[ds][m.slot_key] = {
      name: m.adhoc_name || m.recipe_name || '—',
      kcal: m.kcal,
      protein: m.protein,
      recipeId: m.recipe_id || null,
      minutes: m.minutes || null,
      method: Array.isArray(method) ? method : (typeof method === 'string' ? (() => { try { return JSON.parse(method); } catch { return [method]; } })() : []),
      marinateHours: m.marinate_hours != null ? Number(m.marinate_hours) : null,
      status: m.log_status || 'planned',
    };
  }

  const eventsByDate = {};
  for (const e of eventRows) {
    const ds = toDateStr(e.event_date);
    if (!ds) continue;
    if (!eventsByDate[ds]) eventsByDate[ds] = [];
    eventsByDate[ds].push({
      id: e.id,
      start: timeToStr(e.start_time),
      end: e.end_time ? timeToStr(e.end_time) : null,
      title: e.title,
      person: personKeyFromId(peopleById, e.person_id),
      prep: e.is_prep,
      highlight: e.is_highlight,
      suggested: e.is_suggested,
      done: e.done,
      source: e.source,
    });
  }

  const week = dates.map((d) => {
    const ds = toDateStr(d);
    const dayKey = DAY_KEYS[d.getDay()];
    const meals = mealsByDate[ds] || {};
    const dinnerSlot = meals.dinner || { name: '—', kcal: 0, protein: 0 };
    const dayEvents = eventsByDate[ds] || [];

    const charuEv = dayEvents.find((e) => e.person === 'charu' && !e.prep);
    const shreyaEv = dayEvents.find((e) => e.person === 'shreya' && !e.prep);
    const prepEv = dayEvents.find((e) => e.prep);

    return {
      key: dayKey,
      label: DAY_LABELS[dayKey],
      date: d.getDate(),
      dateStr: ds,
      full: formatFullDate(d),
      who: {
        charu: charuEv?.title || '—',
        shreya: shreyaEv?.title || '—',
      },
      events: dayEvents,
      dinner: {
        name: dinnerSlot.name,
        time: '7:15 PM',
        minutes: dinnerSlot.minutes || 30,
        method: Array.isArray(dinnerSlot.method) && dinnerSlot.method.length
          ? (typeof dinnerSlot.method[0] === 'string' ? dinnerSlot.method[0] : 'stovetop')
          : 'stovetop',
        marinateHours: dinnerSlot.marinateHours || undefined,
        recipeId: dinnerSlot.recipeId || null,
      },
      prep: prepEv ? {
        who: prepEv.person === 'shared' ? 'charu' : prepEv.person,
        task: prepEv.title.replace(/^Prep · /i, ''),
        when: `${DAY_LABELS[dayKey]} ${timeToStr(prepEv.start)}`,
        minutes: 10,
        forTomorrow: false,
        urgent: prepEv.highlight,
      } : null,
      meals: Object.fromEntries(
        activeSlots.map((s) => [s, meals[s] || { name: '—', kcal: 0, protein: 0, recipeId: null, status: 'planned' }]),
      ),
    };
  });

  const recipeCountRows = await sql`select count(*)::int as n from recipes`;
  const shoppingCount = shoppingRows.filter((s) => !s.checked).length;
  const filledSlots = mealRows.length;

  const dayLabelFromDate = (dueDate) => {
    if (!dueDate) return null;
    const ds = toDateStr(dueDate);
    const idx = dates.findIndex((d) => toDateStr(d) === ds);
    if (idx < 0) return null;
    return DAY_LABELS[DAY_KEYS[dates[idx].getDay()]];
  };

  const householdTasks = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    person: personKeyFromId(peopleById, t.person_id),
    due: dayLabelFromDate(t.due_date),
    dueDate: t.due_date ? toDateStr(t.due_date) : null,
    tag: t.tag,
    done: t.done,
    suggested: t.suggested,
    suggestedTime: t.suggested_time ? timeToStr(t.suggested_time) : null,
    note: t.note,
  }));

  const aisleMap = {};
  for (const s of shoppingRows) {
    if (!aisleMap[s.aisle]) aisleMap[s.aisle] = [];
    aisleMap[s.aisle].push({
      id: s.id,
      name: s.name,
      qty: s.qty,
      aisle: s.aisle,
      note: s.note || '',
      store: s.store || '',
      needBy: s.need_by ? toDateStr(s.need_by) : null,
      needByOverride: !!s.need_by_override,
      priority: s.priority || 'normal',
      priorityOverride: !!s.priority_override,
      manualOverride: !!s.manual_override,
      checked: s.checked,
      source: s.source || 'manual',
      merged: (s.note || '').toLowerCase().includes('merged'),
    });
  }
  const shoppingList = Object.entries(aisleMap).map(([aisle, items]) => ({ aisle, items }));

  const itemRecipes = {};
  for (const link of recipeLinkRows) {
    if (!itemRecipes[link.shopping_item_id]) itemRecipes[link.shopping_item_id] = [];
    itemRecipes[link.shopping_item_id].push(link.recipe_name);
  }

  return {
    people,
    proteinFloor: settingsRows[0]?.protein_floor_g || 110,
    todayIndex,
    week,
    weekStart: startStr,
    weekLabel: `Week of ${dates[0].getDate()} ${dates[0].toLocaleDateString('en-GB', { month: 'long' })}`,
    recipeCount: recipeCountRows[0]?.n || 0,
    shoppingUnchecked: shoppingCount,
    filledSlots,
    slotKeys: activeSlots,
    slotLabels,
    customSlots,
    householdTasks,
    taskTags,
    shopCategories,
    shoppingList,
    itemRecipes,
    alreadyAtHome: pantryRows.map((p) => ({
      id: p.id,
      name: p.name,
      aisle: p.aisle || 'Pantry',
      note: p.note || '',
      store: p.store || '',
    })),
    onionBreakdown: [
      { recipe: 'Rajma Chawal', qty: '1 large' },
      { recipe: 'Shawarma Bowls', qty: '2 medium' },
      { recipe: 'Palak Paneer', qty: '1 medium' },
      { recipe: 'Kachumber', qty: '1 small' },
    ],
    skipDinnerMessages: [
      'Dropping Wednesday’s Palak Paneer removes paneer, spinach and cream, and takes onions from 5 down to 4.',
      'Dropping Thursday’s Tandoori Chicken removes chicken and yogurt marinade, and takes lemons from 4 down to 2.',
      'Dropping Monday’s Rajma Chawal removes the rajma entirely, and takes onions from 5 down to 4.',
    ],
  };
}

export { SLOT_KEYS, SLOT_LABELS_BASE, DAY_KEYS, DAY_LABELS, toDateStr, startOfWeek, addDays };
