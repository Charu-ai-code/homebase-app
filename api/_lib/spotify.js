import './env.js';
import { getDb } from './db.js';

const SCOPES = [
  'streaming',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played',
  'user-modify-playback-state',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const REQUIRED_SCOPES = [
  'streaming',
  'user-modify-playback-state',
  'playlist-read-private',
];

export function scopesNeedReconnect(storedScope) {
  if (!storedScope) return true;
  const have = new Set(String(storedScope).split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.some((s) => !have.has(s));
}

export function getMissingScopes(storedScope) {
  if (!storedScope) return [...REQUIRED_SCOPES];
  const have = new Set(String(storedScope).split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !have.has(s));
}

/** Spotify rejects "localhost"; loopback IP with http is still allowed. */
function spotifyBaseUrl() {
  const raw = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  return raw.replace(/:\/\/(localhost|\[::1\])/i, '://127.0.0.1');
}

export function getSpotifyRedirectUri() {
  return `${spotifyBaseUrl()}/api/oauth/spotify/callback`;
}

export function getSpotifyAuthUrl(state) {
  if (!process.env.SPOTIFY_CLIENT_ID) {
    throw new Error('SPOTIFY_CLIENT_ID is not set');
  }
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SCOPES,
    state,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeSpotifyCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(),
  });
  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Spotify token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export async function saveSpotifyTokens(personId, tokens, email) {
  const sql = getDb();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  const scope = tokens.scope || SCOPES;
  await sql`
    insert into external_accounts (person_id, provider, access_token, refresh_token, expires_at, scope, provider_account_email)
    values (
      ${personId}, 'spotify', ${tokens.access_token}, ${tokens.refresh_token || null},
      ${expiresAt}, ${scope}, ${email || null}
    )
    on conflict (person_id, provider) do update
    set access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, external_accounts.refresh_token),
        expires_at = excluded.expires_at,
        scope = excluded.scope,
        provider_account_email = coalesce(excluded.provider_account_email, external_accounts.provider_account_email),
        updated_at = now()
  `;
}

async function refreshSpotifyToken(personId, refreshToken) {
  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const tokens = await res.json();
  await saveSpotifyTokens(personId, {
    ...tokens,
    refresh_token: tokens.refresh_token || refreshToken,
  });
  return tokens.access_token;
}

export async function getSpotifyAccessToken(personId) {
  const sql = getDb();
  const rows = await sql`
    select access_token, refresh_token, expires_at
    from external_accounts
    where person_id = ${personId} and provider = 'spotify'
  `;
  if (!rows.length) return null;
  const row = rows[0];
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 60_000;
  if (expired && row.refresh_token) {
    return refreshSpotifyToken(personId, row.refresh_token);
  }
  return row.access_token;
}

function shapeTrack(item, extras = {}) {
  if (!item) return null;
  return {
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(', '),
    albumArt: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || null,
    trackUrl: item.external_urls?.spotify || null,
    trackUri: item.uri || null,
    durationMs: item.duration_ms || null,
    ...extras,
  };
}

export async function getAccessToken(personId) {
  return getSpotifyAccessToken(personId);
}

export async function playOnDevice(personId, deviceId, { uris, contextUri } = {}) {
  const token = await getSpotifyAccessToken(personId);
  if (!token) throw new Error('Spotify not connected');
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const body = {};
  if (uris?.length) body.uris = uris;
  if (contextUri) body.context_uri = contextUri;
  const res = await fetch(`https://api.spotify.com/v1/me/player/play${q}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('Session expired — reconnect Spotify');
  if (res.status === 403) throw new Error('Spotify Premium required for browser playback');
  if (res.status === 404) throw new Error('Start the browser player first (wait for READY), then try again');
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Play failed (${res.status})${detail ? ': ' + detail.slice(0, 120) : ''}`);
  }
}

export async function transferToDevice(personId, deviceId, play = false) {
  const token = await getSpotifyAccessToken(personId);
  if (!token) throw new Error('Spotify not connected');
  const res = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Transfer failed (${res.status})`);
}

export async function controlSpotifyPlayback(personId, action) {
  const token = await getSpotifyAccessToken(personId);
  if (!token) throw new Error('Spotify not connected');

  const headers = { Authorization: `Bearer ${token}` };
  let url;
  let method = 'PUT';
  if (action === 'play') url = 'https://api.spotify.com/v1/me/player/play';
  else if (action === 'pause') url = 'https://api.spotify.com/v1/me/player/pause';
  else if (action === 'next') { url = 'https://api.spotify.com/v1/me/player/next'; method = 'POST'; }
  else if (action === 'previous') { url = 'https://api.spotify.com/v1/me/player/previous'; method = 'POST'; }
  else throw new Error('Unknown action');

  const res = await fetch(url, { method, headers });
  if (res.status === 401) throw new Error('Session expired — reconnect Spotify');
  if (res.status === 403) throw new Error('Premium + active device required');
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Spotify control failed (${res.status})`);
  }
  return fetchNowPlaying(personId);
}

export async function fetchNowPlaying(personId) {
  const token = await getSpotifyAccessToken(personId);
  if (!token) return { connected: false };

  const headers = { Authorization: `Bearer ${token}` };

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers });

  if (res.status === 401) {
    return { connected: false, error: true, message: 'Session expired — reconnect Spotify' };
  }

  if (res.ok && res.status !== 204) {
    const data = await res.json();
    const shaped = shapeTrack(data.item, {
      connected: true,
      playing: !!data.is_playing,
      progressMs: data.progress_ms ?? null,
    });
    if (shaped) return shaped;
  }

  // Nothing active — show most recent track so the dock isn't empty
  try {
    const recent = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', { headers });
    if (recent.ok) {
      const data = await recent.json();
      const item = data.items?.[0]?.track;
      const shaped = shapeTrack(item, {
        connected: true,
        playing: false,
        paused: true,
        message: 'Last played · tap ▶ in Spotify',
      });
      if (shaped) return shaped;
    }
  } catch { /* optional */ }

  if (res.status === 204 || res.ok) {
    return {
      connected: true,
      playing: false,
      message: 'Play in Spotify, then REFRESH',
    };
  }

  return {
    connected: true,
    playing: false,
    error: true,
    message: 'Spotify error — RECONNECT',
  };
}

export async function fetchUserPlaylists(personId, limit = 30) {
  const token = await getSpotifyAccessToken(personId);
  if (!token) throw new Error('Spotify not connected');
  const res = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('Session expired — reconnect Spotify');
  if (res.status === 403) {
    throw new Error('Missing playlist permission — open MENU → Reconnect Spotify');
  }
  if (!res.ok) throw new Error(`Could not load playlists (${res.status})`);
  const data = await res.json();
  return (data.items || []).map((p) => ({
    id: p.id,
    name: p.name,
    uri: p.uri,
    image: p.images?.[0]?.url || null,
    tracks: p.tracks?.total ?? 0,
    owner: p.owner?.display_name || '',
  }));
}

export async function getSpotifyMeta(personId) {
  const sql = getDb();
  const rows = await sql`
    select scope, provider_account_email
    from external_accounts
    where person_id = ${personId} and provider = 'spotify'
  `;
  if (!rows.length) {
    return { connected: false, needsReconnect: false, email: null };
  }
  const scope = rows[0].scope || '';
  const needsReconnect = scopesNeedReconnect(scope);
  return {
    connected: true,
    email: rows[0].provider_account_email,
    needsReconnect,
    missingScopes: needsReconnect ? getMissingScopes(scope) : [],
  };
}

export async function getSpotifyConnections() {
  const sql = getDb();
  const rows = await sql`
    select p.name, ea.provider_account_email, ea.connected_at
    from people p
    left join external_accounts ea on ea.person_id = p.id and ea.provider = 'spotify'
    order by p.name
  `;
  const out = {};
  for (const row of rows) {
    out[row.name.toLowerCase()] = {
      connected: !!row.provider_account_email || !!row.connected_at,
      email: row.provider_account_email || null,
    };
  }
  return out;
}
