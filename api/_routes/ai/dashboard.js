import { json } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { loadHouseholdData, toDateStr } from '../../_lib/household.js';
import { chat, getCachedInsight, setCachedInsight } from '../../_lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    // Scoped by day so the insight naturally goes stale at midnight even if
    // nothing else invalidates it; task/meal/calendar mutations also bust
    // this key explicitly (see invalidateCache('dashboard-priority') calls
    // in api/household/*.js) so it refreshes within the same day too.
    const cacheKey = `dashboard-priority:${toDateStr(new Date())}`;
    const cached = await getCachedInsight(cacheKey);
    if (cached) {
      json(res, 200, { insight: cached, cached: true });
      return;
    }

    const data = await loadHouseholdData(new Date());
    const day = data.week[data.todayIndex];
    const prompt = JSON.stringify({
      today: day.full,
      dinner: day.dinner,
      prep: day.prep,
      whoop: data.whoop,
      people: data.people,
      openTasks: data.householdTasks.filter((t) => !t.done).slice(0, 5),
    });

    const insight = await chat(
      'You are HomeBase, a household assistant for a couple. Write 2-3 concise sentences about what needs attention today for dinner prep and chores. Be practical and warm. No bullet points.',
      prompt,
    );

    await setCachedInsight(cacheKey, insight);
    json(res, 200, { insight, cached: false });
  } catch (err) {
    console.error('ai dashboard error', err);
    json(res, 500, { error: 'AI insight failed' });
  }
}
