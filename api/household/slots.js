import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { name } = await readJson(req);
  const raw = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!raw || raw.length < 2) {
    json(res, 400, { error: 'Slot name required' });
    return;
  }

  const sql = getDb();
  await sql`
    update household_settings
    set custom_slots = (
      select array(select distinct unnest(coalesce(custom_slots, '{}') || ${[raw]}::text[]))
    )
    where id = true
  `;

  const rows = await sql`select custom_slots from household_settings where id = true`;
  json(res, 200, { customSlots: rows[0]?.custom_slots || [] });
}
