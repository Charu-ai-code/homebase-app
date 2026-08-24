import { json } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { fetchUserPlaylists } from '../../_lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const playlists = await fetchUserPlaylists(auth.person.id);
    json(res, 200, { playlists });
  } catch (err) {
    console.error('spotify playlists error', err);
    json(res, 500, { error: err.message || 'Failed to load playlists' });
  }
}
