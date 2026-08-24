import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { invalidateCache } from '../../_lib/ai.js';

const DEFAULT_TAGS = ['cleaning', 'laundry', 'bills', 'car', 'errands'];

function slugTag(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
}

async function loadTagList(sql) {
  const rows = await sql`select coalesce(custom_task_tags, '{}') as tags from household_settings where id = true`;
  const custom = rows[0]?.tags || [];
  return [...new Set([...DEFAULT_TAGS, ...custom])];
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
    const rows = await sql`
      select id, title, person_id, due_date, tag, done, suggested, suggested_time, note
      from household_tasks order by created_at
    `;
    const people = await sql`select id, name from people`;
    const byId = Object.fromEntries(people.map((p) => [p.id, p.name.toLowerCase()]));
    const tags = await loadTagList(sql);
    json(res, 200, {
      tags,
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
    const body = await readJson(req);

    if (body.addCategory) {
      const tag = slugTag(body.name || body.tag);
      if (!tag || tag.length < 2) {
        json(res, 400, { error: 'Category name required' });
        return;
      }
      await sql`
        update household_settings
        set custom_task_tags = (
          select array(select distinct unnest(coalesce(custom_task_tags, '{}') || ${[tag]}::text[]))
        )
        where id = true
      `;
      const tags = await loadTagList(sql);
      json(res, 201, { tag, tags });
      return;
    }

    const { title, person, tag, dueDate, note } = body;
    if (!title) {
      json(res, 400, { error: 'Title required' });
      return;
    }
    const allowed = new Set(await loadTagList(sql));
    const safeTag = allowed.has(tag) ? tag : (slugTag(tag) && allowed.has(slugTag(tag)) ? slugTag(tag) : 'errands');
    // Allow brand-new tag on create by auto-adding it
    let finalTag = safeTag;
    const requested = slugTag(tag) || 'errands';
    if (!allowed.has(requested) && requested.length >= 2) {
      await sql`
        update household_settings
        set custom_task_tags = (
          select array(select distinct unnest(coalesce(custom_task_tags, '{}') || ${[requested]}::text[]))
        )
        where id = true
      `;
      finalTag = requested;
    } else if (allowed.has(requested)) {
      finalTag = requested;
    }

    const personId = await personIdFromKey(sql, person);
    const rows = await sql`
      insert into household_tasks (title, person_id, due_date, tag, note)
      values (${title}, ${personId}, ${dueDate || null}, ${finalTag}, ${note || null})
      returning id
    `;
    await invalidateCache('calendar');
    await invalidateCache('dashboard-priority');
    json(res, 201, { id: rows[0].id, tag: finalTag, tags: await loadTagList(sql) });
    return;
  }

  if (req.method === 'DELETE') {
    const body = await readJson(req);
    if (body.deleteCategory) {
      const tag = slugTag(body.tag || body.name);
      if (!tag || DEFAULT_TAGS.includes(tag)) {
        json(res, 400, { error: 'Only custom categories can be removed' });
        return;
      }
      await sql`
        update household_settings
        set custom_task_tags = array_remove(coalesce(custom_task_tags, '{}'), ${tag})
        where id = true
      `;
      await sql`
        update household_tasks set tag = 'errands' where tag = ${tag}
      `;
      json(res, 200, { ok: true, tags: await loadTagList(sql) });
      return;
    }

    const { id } = body;
    if (!id) {
      json(res, 400, { error: 'Task id required' });
      return;
    }
    await sql`delete from household_tasks where id = ${id}`;
    await invalidateCache('calendar');
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const { id } = body;
    if (!id) {
      json(res, 400, { error: 'Task id required' });
      return;
    }

    if (body.done !== undefined) {
      await sql`update household_tasks set done = ${body.done} where id = ${id}`;
    }
    if (body.suggested !== undefined) {
      await sql`update household_tasks set suggested = ${body.suggested} where id = ${id}`;
    }
    if (body.title) {
      await sql`update household_tasks set title = ${body.title} where id = ${id}`;
    }
    if (body.tag !== undefined) {
      const requested = slugTag(body.tag) || 'errands';
      const allowed = new Set(await loadTagList(sql));
      if (!allowed.has(requested) && requested.length >= 2) {
        await sql`
          update household_settings
          set custom_task_tags = (
            select array(select distinct unnest(coalesce(custom_task_tags, '{}') || ${[requested]}::text[]))
          )
          where id = true
        `;
      }
      const finalTag = requested.length >= 2 ? requested : 'errands';
      await sql`update household_tasks set tag = ${finalTag} where id = ${id}`;
    }
    if (body.person !== undefined) {
      const personId = await personIdFromKey(sql, body.person);
      await sql`update household_tasks set person_id = ${personId} where id = ${id}`;
    }
    if (body.dueDate !== undefined) {
      await sql`update household_tasks set due_date = ${body.dueDate || null} where id = ${id}`;
    }
    if (body.note !== undefined) {
      await sql`update household_tasks set note = ${body.note || null} where id = ${id}`;
    }

    await invalidateCache('calendar');
    await invalidateCache('dashboard-priority');
    json(res, 200, { ok: true, tags: await loadTagList(sql) });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
