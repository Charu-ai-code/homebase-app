import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { getAccessToken } from '../_lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const accessToken = await getAccessToken(auth.person.id);
    if (!accessToken) {
      json(res, 401, { error: 'Spotify not connected' });
      return;
    }
    json(res, 200, { accessToken });
  } catch (err) {
    console.error('spotify token error', err);
    json(res, 500, { error: err.message || 'Token failed' });
  }
}
