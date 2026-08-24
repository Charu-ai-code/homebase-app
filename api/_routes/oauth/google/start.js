import { redirect, json } from '../../../_lib/response.js';
import { requireAuth } from '../../../_lib/auth.js';
import { randomState } from '../../../_lib/crypto.js';
import { getGoogleAuthUrl } from '../../../_lib/google.js';
import { getDb } from '../../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const state = randomState();
  const sql = getDb();
  await sql`
    insert into ai_insight_cache (cache_key, content)
    values (${'oauth-state:' + state}, ${auth.person.id})
    on conflict (cache_key) do update set content = excluded.content
  `;

  redirect(res, getGoogleAuthUrl(state));
}
