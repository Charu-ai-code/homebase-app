import { redirect, json } from '../../../_lib/response.js';
import { requireAuth } from '../../../_lib/auth.js';
import { randomState } from '../../../_lib/crypto.js';
import { getGoogleAuthUrl, getGoogleRedirectUri } from '../../../_lib/google.js';
import { getDb } from '../../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    json(res, 500, { error: 'Google OAuth is not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const state = randomState();
    const sql = getDb();
    await sql`
      insert into ai_insight_cache (cache_key, content)
      values (${'oauth-state:' + state}, ${auth.person.id})
      on conflict (cache_key) do update set content = excluded.content
    `;

    redirect(res, getGoogleAuthUrl(state, req));
  } catch (err) {
    console.error('google oauth start', err, 'redirect', getGoogleRedirectUri(req));
    json(res, 500, { error: err.message || 'Could not start Google connect' });
  }
}
