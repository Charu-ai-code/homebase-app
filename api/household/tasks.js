import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';
import { invalidateCache } from '../_lib/ai.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`
      select id, title, person_id, due_date, tag, done, suggested, suggested_time, note
      from household_tasks order by created_at
    `;
    const people = await sql`select id, name from people`;
    const byId = Object.fromEntries(people.map((p) => [p.id, p.name.toLowerCase()]));
    json(res, 200, {
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        person: t.person_id ? byId[t.person_id] : 'shared',
        dueDate: t.due_date,
        tag: t.tag,
        done: t.done,
        suggested: t.suggested,
        suggestedTime: t.suggested_time,
        note: t.note,
      })),
    });
    return;
  }

  if (req.method === 'POST') {
    const { title, person, tag, dueDate } = await readJson(req);
    if (!title) {
      json(res, 400, { error: 'Title required' });
      return;
    }
    const people = await sql`select id, name from people`;
    const personRow = person && person !== 'shared'
      ? people.find((p) => p.name.toLowerCase() === person)
      : null;

    const rows = await sql`
      insert into household_tasks (title, person_id, due_date, tag)
      values (${title}, ${personRow?.id || null}, ${dueDate || null}, ${tag || 'errands'})
      returning id
    `;
    await invalidateCache('calendar');
    await invalidateCache('dashboard-priority');
    json(res, 201, { id: rows[0].id });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const { id, done, suggested, title } = body;
    if (!id) {
      json(res, 400, { error: 'Task id required' });
      return;
    }
    if (done !== undefined) {
      await sql`update household_tasks set done = ${done} where id = ${id}`;
    }
    if (suggested !== undefined) {
      await sql`update household_tasks set suggested = ${suggested} where id = ${id}`;
    }
    if (title) {
      await sql`update household_tasks set title = ${title} where id = ${id}`;
    }
    await invalidateCache('calendar');
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
