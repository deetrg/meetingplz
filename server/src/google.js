export const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.readonly';
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export class GoogleAuthError extends Error {}

export function authUrl(env, { redirectUri, state, select = false, scope = SCOPES }) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: select ? 'consent select_account' : 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenCall(env, params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new GoogleAuthError('invalid_grant');
    throw new Error(`google_token_${res.status}`);
  }
  return data;
}

export async function userinfo(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google_userinfo_${res.status}`);
  return res.json();
}

export const exchangeCode = (env, code, redirectUri) =>
  tokenCall(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });

export async function refreshAccessToken(env, refreshToken) {
  const d = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return d.access_token;
}

export function idClaims(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) throw new Error('no_id_token');
  const s = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export async function revokeToken(token) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch { /* best effort */ }
}

const SKIP_CAL = /(#holiday|#contacts|addressbook#)/;

async function gget(accessToken, url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new GoogleAuthError('unauthorized');
  if (!res.ok) throw new Error(`google_api_${res.status}`);
  return res.json();
}

// Returns [{ calendarId, items: [rawEvent] }]
export async function fetchRawEvents(accessToken, now, horizonMs = 24 * 3600 * 1000) {
  const list = await gget(
    accessToken,
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&fields=items(id,selected,primary)',
  );
  const cals = (list.items || []).filter((c) => (c.selected || c.primary) && !SKIP_CAL.test(c.id)).slice(0, 8);
  const timeMin = new Date(now - 60 * 1000).toISOString();
  const timeMax = new Date(now + horizonMs).toISOString();
  const fields =
    'items(id,iCalUID,status,summary,start,end,eventType,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),location,description,transparency,organizer(email,displayName,self),attendees(email,displayName,self,responseStatus,resource,organizer))';
  return Promise.all(
    cals.map(async (c) => {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50', fields });
      const data = await gget(accessToken, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
      return { calendarId: c.id, items: data.items || [] };
    }),
  );
}
