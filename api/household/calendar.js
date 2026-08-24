import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { toDateStr } from '../_lib/household.js';
import { invalidateCache } from '../_lib/ai.js';

function timeToStr(t) {
  if (!t) return '00:00';
  return String(t).slice(0, 5);
}

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'GET') {
    const from = String(req.query?.from || '').slice(0, 10);
    const to = String(req.query?.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      json(res, 400, { error: 'from and to (YYYY-MM-DD) required' });
      return;
    }

    const peopleRows = await sql`select id, name from people`;
    const peopleById = Object.fromEntries(peopleRows.map((p) => [p.id, p.name.toLowerCase()]));

    const rows = await sql`
      select id, event_date, start_time, end_time, title, person_id,
             is_prep, is_highlight, is_suggested, done, source
      from calendar_events
      where event_date >= ${from} and event_date <= ${to}
      order by event_date, start_time
    `;

    const events = rows.map((e) => ({
      id: e.id,
      date: toDateStr(e.event_date),
      start: timeToStr(e.start_time),
      end: e.end_time ? timeToStr(e.end_time) : null,
      title: e.title,
      person: e.person_id ? (peopleById[e.person_id] || 'shared') : 'shared',
      prep: e.is_prep,
      highlight: e.is_highlight,
      suggested: e.is_suggested,
      done: e.done,
      source: e.source,
    }));

    json(res, 200, { from, to, events });
    return;
  }

  if (req.method !== 'PATCH') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { id, done, prepDone } = await readJson(req);

  if (prepDone !== undefined) {
    const today = toDateStr(new Date());
    await sql`
      update calendar_events set done = ${!!prepDone}
      where event_date = ${today} and is_prep = true
    `;
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true });
    return;
  }

  if (!id) {
    json(res, 400, { error: 'Event id required' });
    return;
  }

  if (done !== undefined) {
    await sql`update calendar_events set done = ${done} where id = ${id}`;
    await invalidateCache('dashboard-priority');
  }

  json(res, 200, { ok: true });
}
