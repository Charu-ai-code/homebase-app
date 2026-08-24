import { google } from 'googleapis';
import { getDb } from './db.js';

function appBaseUrl(req) {
  // Prefer the host the user is actually on (local vs production)
  if (req?.headers) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto']
      || (String(host || '').includes('localhost') || String(host || '').startsWith('127.') ? 'http' : 'https');
    if (host) {
      let base = `${proto}://${host}`.replace(/\/$/, '');
      base = base.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1');
      return base;
    }
  }
  const raw = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  return raw.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1').replace(/\/$/, '');
}

function getOAuthClient(req) {
  const baseUrl = appBaseUrl(req);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/oauth/google/callback`,
  );
}

export function getGoogleRedirectUri(req) {
  return `${appBaseUrl(req)}/api/oauth/google/callback`;
}

export function getGoogleAuthUrl(state, req) {
  const oauth2 = getOAuthClient(req);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'openid',
      'email',
    ],
    state,
  });
}

export async function exchangeCode(code, req) {
  const oauth2 = getOAuthClient(req);
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

export async function getAuthedClient(personId) {
  const sql = getDb();
  const rows = await sql`
    select access_token, refresh_token, expires_at
    from external_accounts
    where person_id = ${personId} and provider = 'google'
  `;
  if (!rows.length) return null;

  const oauth2 = getOAuthClient(); // refresh doesn't need request host
  oauth2.setCredentials({
    access_token: rows[0].access_token,
    refresh_token: rows[0].refresh_token,
    expiry_date: rows[0].expires_at ? new Date(rows[0].expires_at).getTime() : null,
  });

  oauth2.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await sql`
        update external_accounts
        set access_token = ${tokens.access_token},
            refresh_token = coalesce(${tokens.refresh_token || null}, refresh_token),
            expires_at = ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null},
            updated_at = now()
        where person_id = ${personId} and provider = 'google'
      `;
    }
  });

  return oauth2;
}

export async function fetchCalendarEvents(auth, timeMin, timeMax) {
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return res.data.items || [];
}

export async function saveGoogleTokens(personId, tokens, email) {
  const sql = getDb();
  await sql`
    insert into external_accounts (person_id, provider, access_token, refresh_token, expires_at, scope, provider_account_email)
    values (
      ${personId},
      'google',
      ${tokens.access_token},
      ${tokens.refresh_token || null},
      ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null},
      'calendar.readonly email openid',
      ${email || null}
    )
    on conflict (person_id, provider) do update
    set access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, external_accounts.refresh_token),
        expires_at = excluded.expires_at,
        provider_account_email = coalesce(excluded.provider_account_email, external_accounts.provider_account_email),
        updated_at = now()
  `;
}

export async function getGoogleConnections() {
  const sql = getDb();
  const rows = await sql`
    select p.name, ea.provider_account_email, ea.connected_at
    from people p
    left join external_accounts ea on ea.person_id = p.id and ea.provider = 'google'
    order by p.name
  `;
  const out = {};
  for (const row of rows) {
    const key = row.name.toLowerCase();
    out[key] = {
      connected: !!row.provider_account_email || !!row.connected_at,
      email: row.provider_account_email || null,
      connectedAt: row.connected_at || null,
    };
  }
  return out;
}

export { getOAuthClient };
