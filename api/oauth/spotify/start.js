import { redirect, json } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { randomState } from '../../_lib/crypto.js';
import { getSpotifyAuthUrl } from '../../_lib/spotify.js';
import { getDb } from '../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    json(res, 500, { error: 'Spotify is not configured — add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const state = randomState();
  const sql = getDb();
  await sql`
    insert into ai_insight_cache (cache_key, content)
    values (${'oauth-spotify:' + state}, ${auth.person.id})
    on conflict (cache_key) do update set content = excluded.content
  `;

  redirect(res, getSpotifyAuthUrl(state));
}
