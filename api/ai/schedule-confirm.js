import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { loadHouseholdData } from '../_lib/household.js';
import { chat, setCachedInsight } from '../_lib/ai.js';
import { getDb } from '../_lib/db.js';
import { toDateStr, getWeekRange } from '../_lib/household.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const data = await loadHouseholdData(new Date());
    const { start } = getWeekRange(new Date());
    const weekStart = toDateStr(start);
    const sql = getDb();

    const result = await chat(
      'You are HomeBase. Given household tasks and calendar free windows, return JSON: { "summary": "one sentence confirming the schedule", "eventTitle": "short event title for calendar block" }',
      JSON.stringify({
        week: data.week,
        tasks: data.householdTasks.filter((t) => t.suggested || !t.done),
      }),
      { jsonMode: true },
    );

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      parsed = { summary: result, eventTitle: 'Shared chores block' };
    }

    for (const t of data.householdTasks.filter((x) => x.suggested)) {
      await sql`update household_tasks set suggested = false where id = ${t.id}`;
    }

    const sat = data.week.find((d) => d.key === 'sat') || data.week[Math.min(5, data.week.length - 1)];
    if (sat) {
      await sql`
        insert into calendar_events (event_date, start_time, end_time, title, person_id, is_highlight, source)
        values (${sat.dateStr}, '10:00', '13:00', ${parsed.eventTitle || 'Deep clean + Costco'}, null, true, 'manual')
      `;
    }

    const summary = parsed.summary || 'Scheduled: shared chores are now on the calendar.';
    await setCachedInsight(`calendar-confirmed:${weekStart}`, summary);
    await setCachedInsight(`calendar-week:${weekStart}`, summary);

    json(res, 200, { summary, confirmed: true });
  } catch (err) {
    console.error('ai schedule confirm error', err);
    json(res, 500, { error: 'Schedule confirmation failed' });
  }
}
