import { json, readJson } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';
import { playOnDevice, fetchNowPlaying } from '../_lib/spotify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const body = await readJson(req);
    const { deviceId, uris, contextUri } = body;
    if (!deviceId) {
      json(res, 400, { error: 'deviceId required' });
      return;
    }
    if (!uris?.length && !contextUri) {
      json(res, 400, { error: 'uris or contextUri required' });
      return;
    }
    await playOnDevice(auth.person.id, deviceId, { uris, contextUri });
    const now = await fetchNowPlaying(auth.person.id);
    json(res, 200, { ok: true, now });
  } catch (err) {
    console.error('spotify play error', err);
    json(res, 500, { error: err.message || 'Play failed' });
  }
}
