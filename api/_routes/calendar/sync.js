import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { getAuthedClient, fetchCalendarEvents, getGoogleConnections } from '../../_lib/google.js';
import { getWeekRange, toDateStr } from '../../_lib/household.js';

function eventToRow(ev, personId) {
  const start = ev.start?.dateTime || ev.start?.date;
  const end = ev.end?.dateTime || ev.end?.date;
  if (!start) return null;

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  const isAllDay = !ev.start?.dateTime;

  return {
    event_date: toDateStr(startDate),
    start_time: isAllDay ? '08:00:00' : startDate.toTimeString().slice(0, 8),
    end_time: isAllDay
      ? '09:00:00'
      : (endDate ? endDate.toTimeString().slice(0, 8) : null),
    title: ev.summary || 'Busy',
    person_id: personId,
    external_event_id: ev.id,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const sql = getDb();
    const body = await readJson(req).catch(() => ({}));
    const people = await sql`select id, name from people order by name`;

    let ref = new Date();
    if (body.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
      ref = new Date(body.weekStart + 'T12:00:00');
    }
    const { start, end } = getWeekRange(ref);
    const timeMin = new Date(start);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(end);
    timeMax.setHours(23, 59, 59, 999);

    const fromStr = toDateStr(timeMin);
    const toStr = toDateStr(timeMax);
    let synced = 0;
    let accounts = 0;

    for (const person of people) {
      const client = await getAuthedClient(person.id);
      if (!client) continue;
      accounts++;

      await sql`
        delete from calendar_events
        where source = 'google'
          and person_id = ${person.id}
          and event_date >= ${fromStr}
          and event_date <= ${toStr}
      `;

      const events = await fetchCalendarEvents(client, timeMin, timeMax);

      for (const ev of events) {
        const row = eventToRow(ev, person.id);
        if (!row) continue;

        await sql`
          insert into calendar_events (
            event_date, start_time, end_time, title, person_id,
            source, external_event_id
          ) values (
            ${row.event_date}, ${row.start_time}, ${row.end_time}, ${row.title}, ${row.person_id},
            'google', ${row.external_event_id}
          )
        `;
        synced++;
      }
    }

    const connections = await getGoogleConnections();
    json(res, 200, {
      synced,
      accounts,
      weekStart: fromStr,
      weekEnd: toStr,
      connections,
      message: accounts === 0
        ? 'No Google account connected — log in as Charu or Shreya, then tap CONNECT'
        : synced === 0
          ? `Connected, but Google primary calendar has no events for ${fromStr} → ${toStr}`
          : `Synced ${synced} event${synced === 1 ? '' : 's'} from Google`,
    });
  } catch (err) {
    console.error('calendar sync error', err);
    json(res, 500, { error: err.message || 'Calendar sync failed' });
  }
}
