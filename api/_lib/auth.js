import { getDb } from './db.js';
import { verifySession, signSession } from './crypto.js';
import { parseCookies, setCookie, clearCookie, json } from './response.js';

const COOKIE = 'homebase_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export function getSession(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE]);
}

export async function requireAuth(req, res) {
  const session = getSession(req);
  if (!session?.personId) {
    json(res, 401, { error: 'Not authenticated' });
    return null;
  }
  const sql = getDb();
  const rows = await sql`select id, name, color, calorie_target from people where id = ${session.personId}`;
  if (!rows.length) {
    json(res, 401, { error: 'Session invalid' });
    return null;
  }
  return { session, person: rows[0] };
}

export function setSessionCookie(res, personId) {
  const token = signSession({
    personId,
    exp: Date.now() + MAX_AGE * 1000,
  });
  setCookie(res, COOKIE, token, { maxAge: MAX_AGE });
}

export function clearSessionCookie(res) {
  clearCookie(res, COOKIE);
}

export { COOKIE };
