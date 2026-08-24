import { google } from 'googleapis';
import { getDb } from './db.js';

function getOAuthClient() {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/oauth/google/callback`,
  );
}

export function getGoogleAuthUrl(state) {
  const oauth2 = getOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state,
  });
}

export async function exchangeCode(code) {
  const oauth2 = getOAuthClient();
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

  const oauth2 = getOAuthClient();
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
      'calendar.readonly',
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
      connected: !!row.provider_account_email,
      email: row.provider_account_email || null,
      connectedAt: row.connected_at || null,
    };
  }
  return out;
}

export { getOAuthClient };
