import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { loadHouseholdData, getWeekRange, addDays, toDateStr, startOfWeek } from '../_lib/household.js';
import { getGoogleConnections } from '../_lib/google.js';
import { getCachedInsight } from '../_lib/ai.js';
import { getDb } from '../_lib/db.js';

function parseWeekRef(req) {
  const q = req.query || {};
  if (q.week && /^\d{4}-\d{2}-\d{2}$/.test(q.week)) {
    return new Date(q.week + 'T12:00:00');
  }
  if (q.offset != null && q.offset !== '') {
    const offset = Number(q.offset) || 0;
    return addDays(startOfWeek(new Date()), offset * 7);
  }
  return new Date();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    let ref = parseWeekRef(req);
    let data = await loadHouseholdData(ref);

    // If this week is empty/sparse and no week= override, jump to the busiest planned week
    const dinnerCount = data.week.filter((d) => d.dinner?.name && d.dinner.name !== '—').length;
    const forced = !!(req.query?.week || req.query?.offset);
    if (dinnerCount < 3 && !forced) {
      const sql = getDb();
      const densest = await sql`
        select week_mon, n from (
          select
            (plan_date - ((extract(isodow from plan_date)::int - 1) * interval '1 day'))::date as week_mon,
            count(*)::int as n
          from meal_plan_slots
          where slot_key = 'dinner'
          group by 1
        ) t
        order by n desc, week_mon desc
        limit 1
      `;
      if (densest.length && densest[0].n > dinnerCount) {
        const planDate = toDateStr(densest[0].week_mon);
        if (planDate) {
          ref = new Date(planDate + 'T12:00:00');
          data = await loadHouseholdData(ref);
        }
      }
    }

    const googleConnections = await getGoogleConnections();
    const weekStart = data.weekStart || data.week[0]?.dateStr || '';
    const [dashboard, calendar, mealplan] = await Promise.all([
      getCachedInsight('dashboard-priority'),
      getCachedInsight(`calendar-week:${weekStart}`),
      getCachedInsight(`mealplan-week:${weekStart}`),
    ]);

    const sql = getDb();
    const calendarAiConfirmed = await sql`
      select content from ai_insight_cache where cache_key = ${'calendar-confirmed:' + weekStart}
    `;

    const { start } = getWeekRange(new Date());
    const currentWeekStart = toDateStr(start);
    const viewedStart = weekStart;
    const weekOffset = Math.round((new Date(viewedStart + 'T12:00:00') - new Date(currentWeekStart + 'T12:00:00')) / (7 * 24 * 60 * 60 * 1000));

    json(res, 200, {
      ...data,
      weekOffset,
      session: {
        personId: auth.person.id,
        name: auth.person.name,
      },
      googleConnections,
      aiInsights: {
        dashboard: dashboard || null,
        calendar: calendar || null,
        mealplan: mealplan || null,
        calendarConfirmed: !!calendarAiConfirmed.length,
      },
    });
  } catch (err) {
    console.error('bootstrap error', err);
    json(res, 500, { error: 'Failed to load household data' });
  }
}
