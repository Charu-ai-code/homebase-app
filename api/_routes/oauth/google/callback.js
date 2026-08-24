import { redirect, json } from '../../../_lib/response.js';
import { exchangeCode, saveGoogleTokens, getGoogleRedirectUri } from '../../../_lib/google.js';
import { getDb } from '../../../_lib/db.js';
import { google } from 'googleapis';

function appOrigin(req) {
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  const proto = req?.headers?.['x-forwarded-proto']
    || (String(host || '').includes('localhost') || String(host || '').startsWith('127.') ? 'http' : 'https');
  if (host) {
    return `${proto}://${host}`.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1').replace(/\/$/, '');
  }
  const raw = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  return raw.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1').replace(/\/$/, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { code, state, error } = req.query || {};
  const base = appOrigin(req);

  if (error) {
    redirect(res, `${base}/?oauth=error&reason=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!code || !state) {
    redirect(res, `${base}/?oauth=missing`);
    return;
  }

  try {
    const sql = getDb();
    const stateRows = await sql`
      select content from ai_insight_cache where cache_key = ${'oauth-state:' + state}
    `;
    if (!stateRows.length) {
      redirect(res, `${base}/?oauth=invalid_state`);
      return;
    }
    const personId = stateRows[0].content;
    await sql`delete from ai_insight_cache where cache_key = ${'oauth-state:' + state}`;

    const tokens = await exchangeCode(code, req);

    let email = null;
    try {
      const oauth2 = new google.auth.OAuth2();
      oauth2.setCredentials(tokens);
      const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
      const profile = await oauth2api.userinfo.get();
      email = profile.data.email;
    } catch {
      // email optional — connection still works via connected_at
    }

    await saveGoogleTokens(personId, tokens, email);
    redirect(res, `${base}/?oauth=connected`);
  } catch (err) {
    console.error('oauth callback error', err, 'expected redirect', getGoogleRedirectUri(req));
    redirect(res, `${base}/?oauth=failed`);
  }
}
