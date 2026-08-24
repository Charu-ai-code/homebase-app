import '../../_lib/env.js';
import { getDb } from '../../_lib/db.js';
import { hashPin } from '../../_lib/crypto.js';
import { json, readJson } from '../../_lib/response.js';
import { setSessionCookie } from '../../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const pin = String(body.pin ?? '').trim();
    if (!pin) {
      json(res, 400, { error: 'PIN required' });
      return;
    }

    const pinHash = hashPin(pin);
    const sql = getDb();
    const rows = await sql`
      select id, name, color, calorie_target
      from people
      where pin_hash = ${pinHash}
    `;

    if (!rows.length) {
      json(res, 401, { error: 'Invalid PIN' });
      return;
    }

    const person = rows[0];
    setSessionCookie(res, person.id);
    json(res, 200, {
      person: {
        id: person.id,
        name: person.name,
        color: person.color,
        calorieTarget: person.calorie_target,
      },
    });
  } catch (err) {
    console.error('login error', err);
    const msg = err.message?.includes('DATABASE_URL')
      ? 'Database not configured — check .env.local'
      : err.message?.includes('relation') || err.message?.includes('does not exist')
        ? 'Database not set up — run npm run migrate && npm run seed'
        : 'Login failed';
    json(res, 500, { error: msg });
  }
}
