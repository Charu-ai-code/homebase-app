import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { loadHouseholdData, toDateStr, getWeekRange } from '../_lib/household.js';
import { chat, getCachedInsight, setCachedInsight } from '../_lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const { start } = getWeekRange(new Date());
    const weekStart = toDateStr(start);
    const cacheKey = `calendar-week:${weekStart}`;
    const cached = await getCachedInsight(cacheKey);
    if (cached) {
      json(res, 200, { insight: cached, cached: true });
      return;
    }

    const data = await loadHouseholdData(new Date());
    const prompt = JSON.stringify({
      week: data.week.map((d) => ({
        day: d.full,
        events: d.events,
        who: d.who,
      })),
      suggestedTasks: data.householdTasks.filter((t) => t.suggested),
      whoop: data.whoop,
    });

    const insight = await chat(
      'You are HomeBase scheduling AI. Find the best 2-3 hour window this week when both people are free for shared chores. Mention specific tasks (deep clean, errands, meal prep). Write 2-3 sentences, conversational tone.',
      prompt,
    );

    await setCachedInsight(cacheKey, insight);
    json(res, 200, { insight, cached: false });
  } catch (err) {
    console.error('ai calendar error', err);
    json(res, 500, { error: 'AI scheduling insight failed' });
  }
}
