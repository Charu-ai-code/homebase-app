import { redirect, json } from '../../_lib/response.js';
import { exchangeCode, saveGoogleTokens } from '../../_lib/google.js';
import { getDb } from '../../_lib/db.js';
import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const { code, state, error } = req.query || {};
  const base = process.env.APP_BASE_URL || 'http://localhost:3000';

  if (error) {
    redirect(res, `${base}/?oauth=error`);
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

    const tokens = await exchangeCode(code);

    let email = null;
    try {
      const oauth2 = new google.auth.OAuth2();
      oauth2.setCredentials(tokens);
      const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
      const profile = await oauth2api.userinfo.get();
      email = profile.data.email;
    } catch {
      // email optional
    }

    await saveGoogleTokens(personId, tokens, email);
    redirect(res, `${base}/?oauth=connected`);
  } catch (err) {
    console.error('oauth callback error', err);
    redirect(res, `${base}/?oauth=failed`);
  }
}
