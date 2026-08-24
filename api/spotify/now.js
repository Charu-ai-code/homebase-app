import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { fetchNowPlaying, getSpotifyConnections, getSpotifyMeta } from '../_lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const [now, connections, meta] = await Promise.all([
      fetchNowPlaying(auth.person.id),
      getSpotifyConnections(),
      getSpotifyMeta(auth.person.id),
    ]);
    json(res, 200, { now, connections, needsReconnect: meta.needsReconnect, spotifyEmail: meta.email });
  } catch (err) {
    console.error('spotify now error', err);
    json(res, 500, { error: 'Spotify unavailable' });
  }
}
