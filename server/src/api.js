import core from './vendor/core.cjs';
import { decryptToken, encryptToken } from './crypto.js';
import { GoogleAuthError, CAL_SCOPE, authUrl, exchangeCode, idClaims, revokeToken } from './google.js';
import { loadUpcoming } from './events.js';
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
  const nonce = randomToken(16);
  const payload = b64uEncode(utf8(JSON.stringify({ c: client, r: client === 'web' ? '' : ret, n: nonce, e: Date.now() + 10 * 60000 })));
  const state = `${payload}.${await hmacSign(env.SESSION_PEPPER, payload)}`;
  const redirectUri = `${publicOrigin(env, url)}/api/auth/google/callback`;
  return redirect(authUrl(env, { redirectUri, state }), [cookie('mp_oauth', nonce, { maxAge: 600, path: '/api/auth' })]);
}

function failRedirect(client, ret, code) {
  const clear = cookie('mp_oauth', '', { maxAge: 0, path: '/api/auth' });
  if (client === 'web' || !ret) return redirect(`/app?error=${encodeURIComponent(code)}`, [clear]);
  return redirect(`${ret}#error=${encodeURIComponent(code)}`, [clear]);
}

async function authCallback(request, env, url) {
  const stateParam = url.searchParams.get('state') || '';
  const [payload, sig] = stateParam.split('.');
  if (!payload || !sig || !(await hmacVerify(env.SESSION_PEPPER, payload, sig))) return json({ error: 'bad_state' }, 400);
  let st;
  try { st = JSON.parse(fromUtf8(b64uDecode(payload))); } catch { return json({ error: 'bad_state' }, 400); }
  if (!st || st.e < Date.now()) return json({ error: 'state_expired' }, 400);
  const nonce = parseCookies(request.headers.get('cookie')).mp_oauth;
  if (!nonce || nonce !== st.n) return json({ error: 'bad_state' }, 400);
  if (url.searchParams.get('error')) return failRedirect(st.c, st.r, url.searchParams.get('error'));
  const code = url.searchParams.get('code');
  if (!code) return failRedirect(st.c, st.r, 'no_code');

  let tok, claims;
  try {
    tok = await exchangeCode(env, code, `${publicOrigin(env, url)}/api/auth/google/callback`);
    claims = idClaims(tok.id_token);
  } catch {
    return failRedirect(st.c, st.r, 'google_exchange_failed');
  }
  if (!String(tok.scope || '').includes(CAL_SCOPE)) return failRedirect(st.c, st.r, 'calendar_access_needed');

  const now = Date.now();
  const existing = await env.DB.prepare('SELECT id, refresh_token_enc FROM users WHERE google_sub = ?').bind(claims.sub).first();
  const enc = tok.refresh_token ? await encryptToken(tok.refresh_token, env.TOKEN_KEY) : existing && existing.refresh_token_enc;
  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, picture = ?, refresh_token_enc = ? WHERE id = ?')
      .bind(claims.email || '', claims.name || '', claims.picture || '', enc || null, userId).run();
    await env.DB.prepare('DELETE FROM events_cache WHERE user_id = ?').bind(userId).run();
  } else {
    userId = randomId();
    await env.DB.prepare(
      'INSERT INTO users (id, google_sub, email, name, picture, refresh_token_enc, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(userId, claims.sub, claims.email || '', claims.name || '', claims.picture || '', enc || null, '{}', now).run();
  }
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, client, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(env.SESSION_PEPPER + token), userId, st.c, now, now).run();

  const clear = cookie('mp_oauth', '', { maxAge: 0, path: '/api/auth' });
  if (st.c === 'web') return redirect('/app', [clear, cookie('mp_session', token, { maxAge: SESSION_DAYS * 86400 })]);
  return redirect(`${st.r}#token=${token}`, [clear]);
}

/* ---------- handlers ---------- */

async function me(request, env, url, user) {
  return json({ email: user.email, name: user.name, picture: user.picture, settings: settingsOf(user) });
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
  if (user.refresh_token_enc) {
    try { await revokeToken(await decryptToken(user.refresh_token_enc, env.TOKEN_KEY)); } catch { /* best effort */ }
  }
  for (const t of ['push_subs', 'sessions', 'events_cache', 'fired', 'snoozes']) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
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
  const route = ROUTES[`${request.method} ${path}`];
  if (!route) return wrap(json({ error: 'not_found' }, 404));
  try {
    let user = null;
    if (route.auth) {
      user = await authed(request, env, url);
      if (!user) return wrap(json({ error: 'unauthorized' }, 401));
    }
    return wrap(await route.fn(request, env, url, user, ctx));
  } catch (e) {
    console.log('api error', path, String(e && e.stack));
    return wrap(json({ error: 'server_error' }, 500));
  }
}
