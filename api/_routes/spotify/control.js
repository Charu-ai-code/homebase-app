import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { controlSpotifyPlayback } from '../../_lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const { action } = await readJson(req);
    if (!['play', 'pause', 'next', 'previous'].includes(action)) {
      json(res, 400, { error: 'action must be play, pause, next, or previous' });
      return;
    }
    const now = await controlSpotifyPlayback(auth.person.id, action);
    json(res, 200, { now });
  } catch (err) {
    console.error('spotify control error', err);
    json(res, 500, { error: err.message || 'Spotify control failed' });
  }
}
