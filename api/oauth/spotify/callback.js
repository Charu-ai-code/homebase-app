import { redirect, json } from '../../_lib/response.js';
import { exchangeSpotifyCode, saveSpotifyTokens, getSpotifyRedirectUri } from '../../_lib/spotify.js';
import { getDb } from '../../_lib/db.js';

function appOrigin() {
  // Stay on 127.0.0.1 after Spotify (localhost is banned as redirect host)
  const raw = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  return raw.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { code, state, error } = req.query || {};
  const base = appOrigin();

  if (error || !code || !state) {
    redirect(res, `${base}/?spotify=error`);
    return;
  }

  try {
    const sql = getDb();
    const stateRows = await sql`
      select content from ai_insight_cache where cache_key = ${'oauth-spotify:' + state}
    `;
    if (!stateRows.length) {
      redirect(res, `${base}/?spotify=invalid_state`);
      return;
    }
    const personId = stateRows[0].content;
    await sql`delete from ai_insight_cache where cache_key = ${'oauth-spotify:' + state}`;

    const tokens = await exchangeSpotifyCode(code);

    let email = null;
    try {
      const me = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (me.ok) {
        const profile = await me.json();
        email = profile.email || profile.display_name || null;
      }
    } catch { /* optional */ }

    await saveSpotifyTokens(personId, tokens, email);
    redirect(res, `${base}/?spotify=connected`);
  } catch (err) {
    console.error('spotify oauth error', err, 'expected redirect', getSpotifyRedirectUri());
    redirect(res, `${base}/?spotify=failed`);
  }
}
