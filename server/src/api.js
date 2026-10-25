import core from './vendor/core.cjs';
import { decryptToken, encryptToken } from './crypto.js';
import { GoogleAuthError, CAL_SCOPE, authUrl, exchangeCode, idClaims, revokeToken } from './google.js';
import { listAccounts, loadUpcoming } from './events.js';
import { buildPayload, pushToUser } from './notify.js';
import { sendWebPush } from './push.js';
import { b64uDecode, b64uEncode, hmacSign, hmacVerify, json, parseCookies, randomId, randomToken, sha256Hex, utf8, fromUtf8 } from './util.js';

const SESSION_DAYS = 90;
const CLIENTS = ['web', 'ext', 'desktop', 'ios'];

/* ---------- helpers ---------- */

export function corsHeaders(origin) {
  if (!origin) return null;
  const ok =
    /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
    origin === 'tauri://localhost' ||
    origin === 'http://tauri.localhost' ||
    origin === 'capacitor://localhost' ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
  if (!ok) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function validReturn(client, ret) {
  if (client === 'web') return true;
  if (!ret) return false;
  if (ret === 'meetingplz://auth') return true;
  try {
    const u = new URL(ret);
    if (u.protocol === 'https:' && u.hostname.endsWith('.chromiumapp.org') && !u.username) return true;
    if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && /^\d+$/.test(u.port)) return true;
  } catch { /* fallthrough */ }
  return false;
}

function cookie(name, value, { maxAge, path = '/' } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const redirect = (location, cookies = []) => {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};

function publicOrigin(env, url) {
  return env.PUBLIC_URL || url.origin;
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function authed(request, env, url) {
  const h = request.headers.get('authorization') || '';
  let token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  let viaCookie = false;
  if (!token) {
    token = parseCookies(request.headers.get('cookie')).mp_session || '';
    viaCookie = !!token;
  }
  if (!token) return null;
  // CSRF guard: cookie-authenticated writes must come from our own origin.
  if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== publicOrigin(env, url)) return null;
  }
  const hash = await sha256Hex(env.SESSION_PEPPER + token);
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT u.*, s.last_seen AS s_last FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  ).bind(hash).first();
  if (!row || now - row.s_last > SESSION_DAYS * 86400000) return null;
  if (now - row.s_last > 3600000) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(now, hash).run();
  }
  row._hash = hash;
  return row;
}

const settingsOf = (user) => core.normalizeSettings(JSON.parse(user.settings_json || '{}'));

/* ---------- auth ---------- */

async function authStart(request, env, url) {
  const client = url.searchParams.get('client') || 'web';
  const ret = url.searchParams.get('return') || '';
  if (!CLIENTS.includes(client)) return json({ error: 'bad_client' }, 400);
  if (!validReturn(client, ret)) return json({ error: 'bad_return' }, 400);
  const { url: gurl, nonceCookie } = await oauthStart(env, url, { client, ret });
  return redirect(gurl, [nonceCookie]);
}

// Signed OAuth state + Google URL. `link` = MeetingPlz user id when adding another Google account.
async function oauthStart(env, url, { client, ret, link = '' }) {
  const nonce = randomToken(16);
  const st = { c: client, r: client === 'web' ? '' : ret, n: nonce, e: Date.now() + 10 * 60000 };
  if (link) st.link = link;
  const payload = b64uEncode(utf8(JSON.stringify(st)));
  const state = `${payload}.${await hmacSign(env.SESSION_PEPPER, payload)}`;
  const redirectUri = `${publicOrigin(env, url)}/api/auth/google/callback`;
  return {
    url: authUrl(env, { redirectUri, state, select: !!link }),
    nonceCookie: cookie(`mp_oauth_${nonce.slice(0, 10)}`, nonce, { maxAge: 600, path: '/api/auth' }),
  };
}

function failRedirect(client, ret, code, st) {
  const clear = cookie(`mp_oauth_${String((st && st.n) || '').slice(0, 10)}`, '', { maxAge: 0, path: '/api/auth' });
  if (client === 'web' || !ret) return redirect(`/app?error=${encodeURIComponent(code)}`, [clear]);
  return redirect(`${ret}#error=${encodeURIComponent(code)}`, [clear]);
}

async function wipeUserRows(env, userId) {
  for (const t of ['push_subs', 'sessions', 'events_cache', 'fired', 'snoozes', 'google_accounts']) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

// Attach the Google account in `claims` to MeetingPlz user `st.link`. Returns an error code or ''.
async function linkAccount(request, env, url, st, claims, tok) {
  const now = Date.now();
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(st.link).first();
  if (!user) return 'link_failed';
  if (st.c === 'web') {
    const who = await authed(request, env, url);
    if (!who || who.id !== st.link) return 'link_failed';
  }
  const enc = tok.refresh_token ? await encryptToken(tok.refresh_token, env.TOKEN_KEY) : null;
  const existing = await env.DB.prepare('SELECT * FROM google_accounts WHERE google_sub = ?').bind(claims.sub).first();
  if (existing) {
    if (existing.user_id !== user.id) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM google_accounts WHERE user_id = ?').bind(existing.user_id).first();
      if (n && n.n > 1) return 'account_in_use';
      // the other MeetingPlz user only had this account: fold it into this user, drop the empty shell
      await env.DB.prepare('UPDATE google_accounts SET user_id = ? WHERE id = ?').bind(user.id, existing.id).run();
      await wipeUserRows(env, existing.user_id);
    }
    if (!enc && !existing.refresh_token_enc) return 'no_refresh_token';
    await env.DB.prepare('UPDATE google_accounts SET email = ?, name = ?, picture = ?, refresh_token_enc = ?, last_error = NULL WHERE id = ?')
      .bind(claims.email || '', claims.name || '', claims.picture || '', enc || existing.refresh_token_enc, existing.id).run();
  } else {
    if (!enc) return 'no_refresh_token';
    await env.DB.prepare(
      'INSERT INTO google_accounts (id, user_id, google_sub, email, name, picture, refresh_token_enc, added_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    ).bind(randomId(), user.id, claims.sub, claims.email || '', claims.name || '', claims.picture || '', enc, now).run();
  }
  await env.DB.prepare('DELETE FROM events_cache WHERE user_id = ?').bind(user.id).run();
  return '';
}

async function authCallback(request, env, url) {
  const stateParam = url.searchParams.get('state') || '';
  const [payload, sig] = stateParam.split('.');
  if (!payload || !sig || !(await hmacVerify(env.SESSION_PEPPER, payload, sig))) return json({ error: 'bad_state' }, 400);
  let st;
  try { st = JSON.parse(fromUtf8(b64uDecode(payload))); } catch { return json({ error: 'bad_state' }, 400); }
  if (!st || st.e < Date.now()) return json({ error: 'state_expired' }, 400);
  // Desktop/extension/iOS link flows open Google in a different browser than the one that asked for the URL,
  // so the nonce cookie can only be required when the flow stays in one browser (web, and every normal sign-in).
  if (!(st.link && st.c !== 'web')) {
    const nonce = st.n ? parseCookies(request.headers.get('cookie'))[`mp_oauth_${String(st.n).slice(0, 10)}`] : '';
    if (!nonce || nonce !== st.n) return json({ error: 'bad_state' }, 400);
  }
  if (url.searchParams.get('error')) return failRedirect(st.c, st.r, url.searchParams.get('error'), st);
  const code = url.searchParams.get('code');
  if (!code) return failRedirect(st.c, st.r, 'no_code', st);

  let tok, claims;
  try {
    tok = await exchangeCode(env, code, `${publicOrigin(env, url)}/api/auth/google/callback`);
    claims = idClaims(tok.id_token);
  } catch {
    return failRedirect(st.c, st.r, 'google_exchange_failed', st);
  }
  if (!String(tok.scope || '').includes(CAL_SCOPE)) return failRedirect(st.c, st.r, 'calendar_access_needed', st);

  const clear = cookie(`mp_oauth_${String((st && st.n) || '').slice(0, 10)}`, '', { maxAge: 0, path: '/api/auth' });
  if (st.link) {
    const err = await linkAccount(request, env, url, st, claims, tok);
    if (err) return failRedirect(st.c, st.r, err, st);
    if (st.c === 'web') return redirect('/app?linked=1', [clear]);
    return redirect(`${st.r}#linked=1`, [clear]);
  }

  const now = Date.now();
  const acct = await env.DB.prepare('SELECT * FROM google_accounts WHERE google_sub = ?').bind(claims.sub).first();
  const enc = tok.refresh_token ? await encryptToken(tok.refresh_token, env.TOKEN_KEY) : acct && acct.refresh_token_enc;
  let userId;
  if (acct) {
    // known account (primary, or linked as a secondary one): sign into the user that owns it
    userId = acct.user_id;
    await env.DB.prepare('UPDATE google_accounts SET email = ?, name = ?, picture = ?, refresh_token_enc = ?, last_error = NULL WHERE id = ?')
      .bind(claims.email || '', claims.name || '', claims.picture || '', enc || null, acct.id).run();
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ? AND google_sub = ?')
      .bind(claims.email || '', claims.name || '', claims.picture || '', userId, claims.sub).run();
    await env.DB.prepare('DELETE FROM events_cache WHERE user_id = ?').bind(userId).run();
  } else {
    userId = randomId();
    await env.DB.prepare(
      'INSERT INTO users (id, google_sub, email, name, picture, refresh_token_enc, settings_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    ).bind(userId, claims.sub, claims.email || '', claims.name || '', claims.picture || '', '{}', now).run();
    await env.DB.prepare(
      'INSERT INTO google_accounts (id, user_id, google_sub, email, name, picture, refresh_token_enc, added_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    ).bind(randomId(), userId, claims.sub, claims.email || '', claims.name || '', claims.picture || '', enc || null, now).run();
  }
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, client, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(env.SESSION_PEPPER + token), userId, st.c, now, now).run();

  if (st.c === 'web') return redirect('/app', [clear, cookie('mp_session', token, { maxAge: SESSION_DAYS * 86400 })]);
  return redirect(`${st.r}#token=${token}`, [clear]);
}

/* ---------- handlers ---------- */

async function me(request, env, url, user) {
  const accounts = (await listAccounts(env, user)).map((a) => ({
    id: a.id, email: a.email || '', picture: a.picture || '', primary: a.google_sub === user.google_sub, error: a.last_error || null,
  }));
  return json({ email: user.email, name: user.name, picture: user.picture, settings: settingsOf(user), accounts });
}

async function accountsLink(request, env, url, user) {
  const b = (await readBody(request)) || {};
  const client = b.client || 'web';
  const ret = b.return || '';
  if (!CLIENTS.includes(client)) return json({ error: 'bad_client' }, 400);
  if (!validReturn(client, ret)) return json({ error: 'bad_return' }, 400);
  const { url: gurl, nonceCookie } = await oauthStart(env, url, { client, ret, link: user.id });
  return json({ url: gurl }, 200, { 'set-cookie': nonceCookie });
}

async function accountsDelete(request, env, url, user, ctx, id) {
  const accounts = await listAccounts(env, user);
  const acct = accounts.find((a) => a.id === id);
  if (!acct) return json({ error: 'not_found' }, 404);
  if (accounts.length <= 1) return json({ error: 'last_account' }, 400);
  if (acct.refresh_token_enc) {
    try { await revokeToken(await decryptToken(acct.refresh_token_enc, env.TOKEN_KEY)); } catch { /* best effort */ }
  }
  await env.DB.prepare('DELETE FROM google_accounts WHERE id = ?').bind(acct.id).run();
  if (acct.google_sub === user.google_sub) {
    // removed the primary: promote the next account so users.google_sub / email keep matching a linked account
    const next = accounts.find((a) => a.id !== acct.id);
    await env.DB.prepare('UPDATE users SET google_sub = ?, email = ?, name = ?, picture = ? WHERE id = ?')
      .bind(next.google_sub, next.email || '', next.name || '', next.picture || '', user.id).run();
  }
  await env.DB.prepare('DELETE FROM events_cache WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}

async function putSettings(request, env, url, user) {
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_body' }, 400);
  const merged = core.normalizeSettings({ ...settingsOf(user), ...core.validateSettings(body) });
  await env.DB.prepare('UPDATE users SET settings_json = ? WHERE id = ?').bind(JSON.stringify(merged), user.id).run();
  return json(merged);
}

async function logout(request, env, url, user) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user._hash).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie('mp_session', '', { maxAge: 0 }) });
}

async function upcoming(request, env, url, user) {
  try {
    const events = await loadUpcoming(env, user, { maxAgeMs: 90000 });
    return json({ now: Date.now(), events });
  } catch (e) {
    if (e instanceof GoogleAuthError) return json({ error: 'reauth' }, 401);
    return json({ error: 'upstream' }, 502);
  }
}

async function vapid(request, env) {
  return json({ publicKey: env.VAPID_PUBLIC_KEY });
}

async function pushSubscribe(request, env, url, user) {
  const b = await readBody(request);
  const endpoint = b && b.endpoint;
  const keys = (b && b.keys) || b || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !keys.p256dh || !keys.auth) {
    return json({ error: 'bad_subscription' }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, ua, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = ?1, p256dh = ?3, auth = ?4, ua = ?5`,
  ).bind(user.id, endpoint, String(keys.p256dh), String(keys.auth), (request.headers.get('user-agent') || '').slice(0, 200), Date.now()).run();
  return json({ ok: true });
}

async function pushUnsubscribe(request, env, url, user) {
  const b = await readBody(request);
  if (!b || typeof b.endpoint !== 'string') return json({ error: 'bad_body' }, 400);
  await env.DB.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').bind(user.id, b.endpoint).run();
  return json({ ok: true });
}

async function testReminder(request, env, url, user, ctx) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').bind(user.id).first();
  if (!row || !row.n) return json({ error: 'no_subscriptions' }, 400);
  const start = Date.now() + 5000 + 120000;
  const evt = { key: `test:${start}`, title: 'Quick sync', start, link: '' };
  const payload = buildPayload(evt, Date.now() + 5000);
  payload.body = `Quick sync starts in 2 min \u00b7 Join on Meet`;
  payload.data.url = '/app';
  payload.data.test = true;
  const send = (async () => {
    await new Promise((r) => setTimeout(r, env.TEST_DELAY_MS ?? 5000));
    return pushToUser(env, user.id, payload, env.__send || sendWebPush);
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(send.catch(() => {}));
  else await send;
  return json({ ok: true, sendsInSeconds: 5, subscriptions: row.n });
}

async function snooze(request, env, url, user) {
  const b = await readBody(request);
  if (!b || typeof b.key !== 'string') return json({ error: 'bad_body' }, 400);
  const secs = Math.min(1800, Math.max(30, Math.round(Number(b.seconds) || settingsOf(user).snoozeSeconds)));
  await env.DB.prepare(
    'INSERT INTO snoozes (user_id, event_key, until) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, event_key) DO UPDATE SET until = ?3',
  ).bind(user.id, b.key.slice(0, 300), Date.now() + secs * 1000).run();
  return json({ ok: true, seconds: secs });
}

export async function deleteAccount(request, env, url, user) {
  for (const a of await listAccounts(env, user)) {
    if (!a.refresh_token_enc) continue;
    try { await revokeToken(await decryptToken(a.refresh_token_enc, env.TOKEN_KEY)); } catch { /* best effort */ }
  }
  await wipeUserRows(env, user.id);
  return json({ ok: true }, 200, { 'set-cookie': cookie('mp_session', '', { maxAge: 0 }) });
}

const ROUTES = {
  'GET /api/auth/google/start': { fn: authStart, auth: false },
  'GET /api/auth/google/callback': { fn: authCallback, auth: false },
  'GET /api/push/vapid': { fn: vapid, auth: false },
  'GET /api/me': { fn: me, auth: true },
  'DELETE /api/me': { fn: deleteAccount, auth: true },
  'DELETE /api/account': { fn: deleteAccount, auth: true },
  'PUT /api/settings': { fn: putSettings, auth: true },
  'POST /api/logout': { fn: logout, auth: true },
  'GET /api/upcoming': { fn: upcoming, auth: true },
  'POST /api/push/subscribe': { fn: pushSubscribe, auth: true },
  'DELETE /api/push/subscribe': { fn: pushUnsubscribe, auth: true },
  'POST /api/test-reminder': { fn: testReminder, auth: true },
  'POST /api/snooze': { fn: snooze, auth: true },
  'POST /api/accounts/link': { fn: accountsLink, auth: true },
};

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin'));
  const wrap = (res) => {
    if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  };
  if (request.method === 'OPTIONS') return wrap(new Response(null, { status: 204 }));
  const path = url.pathname.replace(/\/+$/, '');
  let route = ROUTES[`${request.method} ${path}`];
  let arg;
  const del = request.method === 'DELETE' && path.match(/^\/api\/accounts\/([A-Za-z0-9_-]{1,64})$/);
  if (del) { route = { fn: accountsDelete, auth: true }; arg = del[1]; }
  if (!route) return wrap(json({ error: 'not_found' }, 404));
  try {
    let user = null;
    if (route.auth) {
      user = await authed(request, env, url);
      if (!user) return wrap(json({ error: 'unauthorized' }, 401));
    }
    return wrap(await route.fn(request, env, url, user, ctx, arg));
  } catch (e) {
    console.log('api error', path, String(e && e.stack));
    return wrap(json({ error: 'server_error' }, 500));
  }
}
