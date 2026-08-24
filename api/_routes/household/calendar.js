import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { toDateStr } from '../../_lib/household.js';
import { invalidateCache } from '../../_lib/ai.js';

function timeToStr(t) {
  if (!t) return '00:00';
  return String(t).slice(0, 5);
}

async function personIdFromKey(sql, person) {
  if (!person || person === 'shared') return null;
  const people = await sql`select id, name from people`;
  const row = people.find((p) => p.name.toLowerCase() === String(person).toLowerCase());
  return row?.id || null;
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

  if (req.method === 'POST') {
    const body = await readJson(req);
    const title = String(body.title || '').trim();
    const date = String(body.date || '').slice(0, 10);
    const start = String(body.start || '09:00').slice(0, 5);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      json(res, 400, { error: 'title and date (YYYY-MM-DD) required' });
      return;
    }
    const personId = await personIdFromKey(sql, body.person);
    const end = body.end ? String(body.end).slice(0, 5) : null;
    const rows = await sql`
      insert into calendar_events (
        event_date, start_time, end_time, title, person_id,
        is_prep, is_highlight, source
      ) values (
        ${date}, ${start}, ${end}, ${title}, ${personId},
        ${!!body.prep}, ${!!body.highlight}, 'manual'
      )
      returning id
    `;
    await invalidateCache('dashboard-priority');
    await invalidateCache('calendar');
    json(res, 201, { id: rows[0].id });
    return;
  }

  if (req.method === 'DELETE') {
    const body = await readJson(req);
    const id = body.id;
    if (!id) {
      json(res, 400, { error: 'Event id required' });
      return;
    }
    const rows = await sql`select source from calendar_events where id = ${id}`;
    if (!rows.length) {
      json(res, 404, { error: 'Event not found' });
      return;
    }
    await sql`delete from calendar_events where id = ${id}`;
    await invalidateCache('dashboard-priority');
    await invalidateCache('calendar');
    json(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'PATCH') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJson(req);
  const { id, done, prepDone } = body;

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

  if (done !== undefined && body.title === undefined && body.date === undefined && body.start === undefined && body.person === undefined) {
    await sql`update calendar_events set done = ${done} where id = ${id}`;
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true });
    return;
  }

  const existing = await sql`select id from calendar_events where id = ${id}`;
  if (!existing.length) {
    json(res, 404, { error: 'Event not found' });
    return;
  }

  const title = body.title != null ? String(body.title).trim() : undefined;
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date).slice(0, 10))
    ? String(body.date).slice(0, 10)
    : undefined;
  const start = body.start != null ? String(body.start).slice(0, 5) : undefined;
  const end = body.end !== undefined ? (body.end ? String(body.end).slice(0, 5) : null) : undefined;
  const personId = body.person !== undefined ? await personIdFromKey(sql, body.person) : undefined;
  const prep = body.prep !== undefined ? !!body.prep : undefined;
  const highlight = body.highlight !== undefined ? !!body.highlight : undefined;

  if (title !== undefined) await sql`update calendar_events set title = ${title} where id = ${id}`;
  if (date !== undefined) await sql`update calendar_events set event_date = ${date} where id = ${id}`;
  if (start !== undefined) await sql`update calendar_events set start_time = ${start} where id = ${id}`;
  if (end !== undefined) await sql`update calendar_events set end_time = ${end} where id = ${id}`;
  if (personId !== undefined) await sql`update calendar_events set person_id = ${personId} where id = ${id}`;
  if (prep !== undefined) await sql`update calendar_events set is_prep = ${prep} where id = ${id}`;
  if (highlight !== undefined) await sql`update calendar_events set is_highlight = ${highlight} where id = ${id}`;
  if (done !== undefined) await sql`update calendar_events set done = ${!!done} where id = ${id}`;

  await invalidateCache('dashboard-priority');
  await invalidateCache('calendar');
  json(res, 200, { ok: true });
}
