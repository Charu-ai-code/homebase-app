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

export async function loadHouseholdData(referenceDate = new Date()) {
  const sql = getDb();
  const { start, end, dates } = getWeekRange(referenceDate);
  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  const peopleRows = await sql`select id, name, color, calorie_target from people order by name`;
  const settingsRows = await sql`select protein_floor_g, coalesce(custom_slots, '{}') as custom_slots from household_settings where id = true`;
  const customSlots = settingsRows[0]?.custom_slots || [];
  const activeSlots = [...SLOT_KEYS, ...customSlots.filter((s) => !SLOT_KEYS.includes(s))];
  const slotLabels = { ...SLOT_LABELS_BASE };
  for (const s of customSlots) {
    slotLabels[s] = s.replace(/_/g, ' ').toUpperCase();
  }
  const whoopRows = await sql`
    select person_id, recovery_pct, sleep_minutes, strain
    from whoop_manual_entries
    where entry_date >= ${startStr} and entry_date <= ${endStr}
  `;

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

  const whoop = {};
  for (const key of Object.keys(people)) {
    whoop[key] = { recovery: 70, sleep: '—', strain: 0 };
  }
  for (const w of whoopRows) {
    const key = personKeyFromId(peopleById, w.person_id);
    if (key === 'shared') continue;
    const sleepH = w.sleep_minutes ? Math.floor(w.sleep_minutes / 60) : 0;
    const sleepM = w.sleep_minutes ? w.sleep_minutes % 60 : 0;
    whoop[key] = {
      recovery: w.recovery_pct ?? 70,
      sleep: w.sleep_minutes ? `${sleepH}h ${String(sleepM).padStart(2, '0')}m` : '—',
      strain: Number(w.strain) || 0,
    };
  }

  const mealRows = await sql`
    select m.plan_date, m.slot_key, m.adhoc_name, m.kcal, m.protein, m.recipe_id,
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
    select s.id, s.name, s.qty, s.aisle, s.note, s.checked
    from shopping_list_items s
    order by s.aisle, s.name
  `;

  const recipeLinkRows = await sql`
    select sir.shopping_item_id, r.name as recipe_name, sir.qty_contributed
    from shopping_item_recipes sir
    join recipes r on r.id = sir.recipe_id
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
        activeSlots.map((s) => [s, meals[s] || { name: '—', kcal: 0, protein: 0, recipeId: null }]),
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
      note: s.note || '',
      checked: s.checked,
      merged: (s.note || '').includes('merged'),
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
    whoop,
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
    shoppingList,
    itemRecipes,
    alreadyAtHome: ['Basmati', 'Ginger', 'Garam masala', 'Turmeric', 'Cumin seed', 'Ghee', 'Green chilies', 'Chana dal', 'Mustard oil'],
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
