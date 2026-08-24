import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { getAuthedClient, fetchCalendarEvents } from '../_lib/google.js';
import { getWeekRange, toDateStr } from '../_lib/household.js';

function eventToRow(ev, personId) {
  const start = ev.start?.dateTime || ev.start?.date;
  const end = ev.end?.dateTime || ev.end?.date;
  if (!start) return null;

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;

  return {
    event_date: toDateStr(startDate),
    start_time: startDate.toTimeString().slice(0, 8),
    end_time: endDate ? endDate.toTimeString().slice(0, 8) : null,
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
    const people = await sql`select id, name from people order by name`;
    const { start, end } = getWeekRange(new Date());
    const timeMin = new Date(start);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(end);
    timeMax.setHours(23, 59, 59, 999);

    let synced = 0;

    for (const person of people) {
      const client = await getAuthedClient(person.id);
      if (!client) continue;

      await sql`
        delete from calendar_events
        where source = 'google'
          and person_id = ${person.id}
          and event_date >= ${toDateStr(timeMin)}
          and event_date <= ${toDateStr(timeMax)}
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

    json(res, 200, { synced });
  } catch (err) {
    console.error('calendar sync error', err);
    json(res, 500, { error: 'Calendar sync failed' });
  }
}
