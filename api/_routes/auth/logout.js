import { json } from '../../_lib/response.js';
import { clearSessionCookie } from '../../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }
  clearSessionCookie(res);
  json(res, 200, { ok: true });
}
