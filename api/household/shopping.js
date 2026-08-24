import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const sql = getDb();

  if (req.method === 'PATCH') {
    const { id, checked } = await readJson(req);
    if (!id) {
      json(res, 400, { error: 'Item id required' });
      return;
    }
    await sql`update shopping_list_items set checked = ${!!checked} where id = ${id}`;
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST') {
    const { name, qty, aisle, note } = await readJson(req);
    if (!name) {
      json(res, 400, { error: 'Name required' });
      return;
    }
    const rows = await sql`
      insert into shopping_list_items (name, qty, aisle, note, added_by)
      values (${name}, ${qty || '1'}, ${aisle || 'Other'}, ${note || 'Added manually'}, ${auth.person.id})
      returning id
    `;
    json(res, 201, { id: rows[0].id });
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}
