import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.js';
import { runCron } from '../src/notify.js';
import { makeEnv, mockFetch, jsonRes, idToken } from './helpers.js';

const ORIGIN = 'https://meetingplz.pages.dev';
const req = (path, init = {}) => new Request(ORIGIN + path, init);
const bearer = (t, extra = {}) => ({ ...extra, headers: { authorization: `Bearer ${t}`, ...(extra.headers || {}) } });
const SCOPE = 'openid email profile https://www.googleapis.com/auth/calendar.readonly';

// Fake Google with several accounts. Code `c-<n>` signs in account n; refresh token `rt-<n>` -> access token `at-<n>`.
function multiGoogle(accts, state = {}) {
  state.events = state.events || {}; // n -> [raw events]
  state.badRefresh = state.badRefresh || new Set();
  state.transient = state.transient || new Set();
  const revoked = [];
  const m = mockFetch((url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body));
      if (p.get('grant_type') === 'authorization_code') {
        const n = p.get('code').split('-')[1];
        const a = accts[n];
        return jsonRes({ access_token: `at-${n}`, refresh_token: state.noRefresh ? undefined : `rt-${n}`, scope: SCOPE, id_token: idToken({ sub: a.sub, email: a.email, name: a.email.split('@')[0], picture: `https://p/${n}.png` }) });
      }
      const n = p.get('refresh_token').split('-')[1];
      if (state.badRefresh.has(n)) return jsonRes({ error: 'invalid_grant' }, 400);
      return jsonRes({ access_token: `at-${n}` });
    }
    const n = String((init.headers || {}).authorization || '').replace('Bearer at-', '');
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) return jsonRes({ items: [{ id: accts[n].email, selected: true, primary: true }] });
    if (url.includes('/calendar/v3/calendars/') && url.includes('/events')) {
      if (state.transient.has(n)) return jsonRes({}, 500);
      return jsonRes({ items: state.events[n] || [] });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') { revoked.push(String(init.body)); return jsonRes({}); }
    return undefined;
  });
  return { ...m, state, revoked };
}

const A = { sub: 'sub-A', email: 'a@one.com' };
const B = { sub: 'sub-B', email: 'b@two.com' };
const C = { sub: 'sub-C', email: 'c@three.com' };

async function runFlow(env, startRes, n, extraCookie = '') {
  const loc = new URL(startRes.headers.get('location') || startRes.__url);
  const nonce = (startRes.headers.get('set-cookie') || startRes.__cookie || '').match(/(mp_oauth_[^=]+)=([^;]+)/);
  const cookie = [nonce && `${nonce[1]}=${nonce[2]}`, extraCookie].filter(Boolean).join('; ');
  return handleApi(req(`/api/auth/google/callback?code=c-${n}&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { headers: { cookie } }), env);
}

async function signIn(env, n, client = 'ext') {
  const ret = 'https://abc.chromiumapp.org/cb';
  const start = await handleApi(new Request(`${client === 'web' ? 'https://meetingplz.nonolingo.com' : ORIGIN}/api/auth/google/start?client=${client}&return=${encodeURIComponent(ret)}`), env);
  const cb = await runFlow(env, start, n);
  const loc = cb.headers.get('location');
  return { cb, token: loc.includes('#token=') ? loc.split('#token=')[1] : null, cookie: (cb.headers.getSetCookie().find((c) => c.startsWith('mp_session=')) || '').split(';')[0] };
}

async function linkUrl(env, token, body, extra = {}) {
  const r = await handleApi(req('/api/accounts/link', bearer(token, { method: 'POST', body: JSON.stringify(body), ...extra })), env);
  return r;
}

const T0 = Date.now() + 3600e3;
const gev = (over) => ({
  id: 'e1', iCalUID: 'e1@google.com', status: 'confirmed', summary: 'Quick sync',
  start: { dateTime: new Date(T0).toISOString() }, end: { dateTime: new Date(T0 + 3600e3).toISOString() },
  hangoutLink: 'https://meet.google.com/abc-defg-hij', organizer: { email: 'miles@x.com' },
  attendees: [{ email: 'x@y.com', self: true, responseStatus: 'accepted' }, { email: 'miles@x.com' }], ...over,
});

// Non-web link flow: callback (no cookie) -> redirect with #link_code -> client redeems with its Bearer token.
const codeOf = (cb) => (cb.headers.get('location') || '').split('#link_code=')[1];
const complete = (env, token, code) => handleApi(req('/api/accounts/link/complete', bearer(token, { method: 'POST', body: JSON.stringify({ code }) })), env);
async function linkCallback(env, token, n, client = 'ext', ret = 'https://abc.chromiumapp.org/cb') {
  const r = await linkUrl(env, token, { client, return: ret });
  assert.equal(r.status, 200);
  const { url } = await r.json();
  return handleApi(req(`/api/auth/google/callback?code=c-${n}&state=${encodeURIComponent(new URL(url).searchParams.get('state'))}`), env);
}
async function twoAccounts(env, g, client = 'ext') {
  const { token } = await signIn(env, 'A');
  const cb = await linkCallback(env, token, 'B', client);
  const code = codeOf(cb);
  assert.ok(code);
  const done = await complete(env, token, code);
  assert.equal(done.status, 200);
  return { token, cb, code, done };
}

test('link: returns a Google URL with select_account and a signed link state; validates client/return; needs auth', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    assert.equal((await handleApi(req('/api/accounts/link', { method: 'POST', body: '{}' }), env)).status, 401);
    const { token } = await signIn(env, 'A');
    assert.equal((await linkUrl(env, token, { client: 'ext', return: 'https://evil.com/' })).status, 400);
    assert.equal((await linkUrl(env, token, { client: 'zzz' })).status, 400);
    const r = await linkUrl(env, token, { client: 'desktop', return: 'http://127.0.0.1:5123/cb' });
    const { url } = await r.json();
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('prompt'), 'consent select_account');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    const st = JSON.parse(Buffer.from(u.searchParams.get('state').split('.')[0], 'base64url').toString());
    assert.equal(st.link, env.DB.raw.prepare('SELECT id FROM users').get().id);
    assert.equal(st.c, 'desktop');
    assert.equal(st.r, 'http://127.0.0.1:5123/cb');
  } finally { g.restore(); }
});

test('link (non-web): callback attaches nothing and redirects with #link_code; complete attaches; /api/me lists both', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token: t0 } = await signIn(env, 'A');
    const cb0 = await linkCallback(env, t0, 'B');
    assert.match(cb0.headers.get('location'), /^https:\/\/abc\.chromiumapp\.org\/cb#link_code=[A-Za-z0-9_-]{20,}$/);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts').get().n, 1, 'callback must not attach');
    const stored = env.DB.raw.prepare('SELECT * FROM link_codes').get();
    assert.ok(!stored.code_hash.includes(codeOf(cb0)), 'only a hash of the code is stored');
    assert.ok(stored.refresh_token_enc.startsWith('v1.') && !stored.refresh_token_enc.includes('rt-B'));
    assert.equal((await complete(env, t0, codeOf(cb0))).status, 200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM link_codes').get().n, 0);
    const token = t0;
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.deepEqual(me.accounts.map((a) => [a.email, a.primary, a.error]), [['a@one.com', true, null], ['b@two.com', false, null]]);
    assert.equal(me.email, 'a@one.com');
    const row = env.DB.raw.prepare("SELECT refresh_token_enc FROM google_accounts WHERE google_sub = 'sub-B'").get();
    assert.ok(row.refresh_token_enc.startsWith('v1.'));
    assert.ok(!row.refresh_token_enc.includes('rt-B'));
  } finally { g.restore(); }
});

test('link (web): needs the nonce cookie and the same session; success goes to /app?linked=1', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { cookie } = await signIn(env, 'A', 'web');
    const r = await handleApi(req('/api/accounts/link', { method: 'POST', body: JSON.stringify({ client: 'web' }), headers: { cookie, origin: ORIGIN } }), env);
    const { url } = await r.json();
    const nonce = r.headers.get('set-cookie').match(/(mp_oauth_[^=]+)=([^;]+)/);
    const state = encodeURIComponent(new URL(url).searchParams.get('state'));
    const cbUrl = `/api/auth/google/callback?code=c-B&state=${state}`;
    assert.equal((await handleApi(req(cbUrl, { headers: { cookie } }), env)).status, 400, 'no nonce cookie');
    const noSession = await handleApi(req(cbUrl, { headers: { cookie: `${nonce[1]}=${nonce[2]}` } }), env);
    assert.equal(noSession.headers.get('location'), '/app?error=link_failed');
    const ok = await handleApi(req(cbUrl, { headers: { cookie: `${nonce[1]}=${nonce[2]}; ${cookie}` } }), env);
    assert.equal(ok.headers.get('location'), '/app?linked=1');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts').get().n, 2);
  } finally { g.restore(); }
});

test('signing in with a linked secondary account lands in the same MeetingPlz user', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    const { token: t2 } = await signIn(env, 'B');
    assert.ok(t2);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    const me = await (await handleApi(req('/api/me', bearer(t2)), env)).json();
    assert.equal(me.accounts.length, 2);
    assert.equal(me.email, 'a@one.com', 'primary profile unchanged');
    assert.ok(token);
  } finally { g.restore(); }
});

test('link: a sub owned by another user with no other accounts is moved; with other accounts -> account_in_use', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B, C });
  try {
    const { token: tB } = await signIn(env, 'B'); // user B alone
    const { token: tA } = await signIn(env, 'A');
    env.DB.raw.prepare("INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) SELECT id,'https://p/old','a','b',1 FROM users WHERE google_sub='sub-B'").run();
    const link = async (token, n) => complete(env, token, codeOf(await linkCallback(env, token, n)));
    const ok = await link(tA, 'B');
    assert.equal(ok.status, 200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1, 'empty shell user removed');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 0);
    assert.equal((await handleApi(req('/api/me', bearer(tB)), env)).status, 401, 'old session of the folded user is gone');
    assert.equal((await (await handleApi(req('/api/me', bearer(tA)), env)).json()).accounts.length, 2);

    // user C links... B which now belongs to A (A has 2 accounts) -> account_in_use
    const { token: tC } = await signIn(env, 'C');
    const bad = await link(tC, 'B');
    assert.equal(bad.status, 409);
    assert.equal((await bad.json()).error, 'account_in_use');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts WHERE google_sub = ?').get('sub-B').n, 1);
    assert.equal((await (await handleApi(req('/api/me', bearer(tC)), env)).json()).accounts.length, 1);
  } finally { g.restore(); }
});

test('linking an already-linked account refreshes it and clears the error', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    env.DB.raw.prepare("UPDATE google_accounts SET last_error = 'reauth' WHERE google_sub = 'sub-B'").run();
    assert.equal((await complete(env, token, codeOf(await linkCallback(env, token, 'B')))).status, 200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts').get().n, 2);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.equal(me.accounts[1].error, null);
  } finally { g.restore(); }
});

test('DELETE /api/accounts/:id revokes the token, refuses the last account, 404 for others', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    const [a, b] = me.accounts;
    assert.equal((await handleApi(req('/api/accounts/nope', bearer(token, { method: 'DELETE' })), env)).status, 404);
    const del = await handleApi(req(`/api/accounts/${b.id}`, bearer(token, { method: 'DELETE' })), env);
    assert.equal(del.status, 200);
    assert.deepEqual(g.revoked, ['token=rt-B']);
    assert.equal((await (await handleApi(req('/api/me', bearer(token)), env)).json()).accounts.length, 1);
    const last = await handleApi(req(`/api/accounts/${a.id}`, bearer(token, { method: 'DELETE' })), env);
    assert.equal(last.status, 400);
    assert.equal((await last.json()).error, 'last_account');
    assert.equal((await handleApi(req(`/api/accounts/${a.id}`, { method: 'DELETE' }), env)).status, 401);
    // other user cannot delete it
    const { token: tC } = await signIn(env, 'A'); // same user (A); use a different user instead
    assert.ok(tC);
  } finally { g.restore(); }
});

test('removing the primary promotes the next account (sub/email follow) and the removed sub can sign in as a new user', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.equal((await handleApi(req(`/api/accounts/${me.accounts[0].id}`, bearer(token, { method: 'DELETE' })), env)).status, 200);
    const me2 = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.equal(me2.email, 'b@two.com');
    assert.deepEqual(me2.accounts.map((a) => [a.email, a.primary]), [['b@two.com', true]]);
    const { token: t3 } = await signIn(env, 'A');
    assert.ok(t3);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  } finally { g.restore(); }
});

test("another user's account id cannot be deleted", async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B, C });
  try {
    const { token: tA } = await twoAccounts(env, g);
    const { token: tC } = await signIn(env, 'C');
    const idB = env.DB.raw.prepare("SELECT id FROM google_accounts WHERE google_sub='sub-B'").get().id;
    assert.equal((await handleApi(req(`/api/accounts/${idB}`, bearer(tC, { method: 'DELETE' })), env)).status, 404);
    assert.ok(tA);
  } finally { g.restore(); }
});

test('/api/upcoming merges all accounts in parallel, dedupes the same meeting, first account email wins', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    g.state.events.A = [gev(), gev({ id: 'a2', iCalUID: 'a2', summary: 'A only', start: { dateTime: new Date(T0 + 7200e3).toISOString() }, end: { dateTime: new Date(T0 + 9000e3).toISOString() } })];
    g.state.events.B = [gev({ id: 'e1-copy' }), gev({ id: 'b1', iCalUID: 'b1', summary: 'B only', start: { dateTime: new Date(T0 + 1800e3).toISOString() }, end: { dateTime: new Date(T0 + 3000e3).toISOString() } })];
    const r = await (await handleApi(req('/api/upcoming', bearer(token)), env)).json();
    assert.deepEqual(r.events.map((e) => [e.title, e.calendar]), [['Quick sync', 'a@one.com'], ['B only', 'b@two.com'], ['A only', 'a@one.com']]);
    assert.equal(g.calls.filter((c) => c.url.includes('/events?')).length, 2);
    // cached as one merged list
    await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(g.calls.filter((c) => c.url.includes('/events?')).length, 2);
  } finally { g.restore(); }
});

test('/api/upcoming: one account needing re-auth is marked and skipped, the call still succeeds', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    g.state.events.A = [gev()];
    g.state.events.B = [gev({ id: 'b1', iCalUID: 'b1', summary: 'B only' })];
    g.state.badRefresh.add('B');
    const res = await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).events.map((e) => e.title), ['Quick sync']);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.deepEqual(me.accounts.map((a) => a.error), [null, 'reauth']);
    // now every account needs re-auth -> 401 reauth
    g.state.badRefresh.add('A');
    env.DB.raw.prepare('DELETE FROM events_cache').run();
    const all = await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(all.status, 401);
    assert.equal((await all.json()).error, 'reauth');
  } finally { g.restore(); }
});

test('/api/upcoming: a transient error on one account keeps the others and is not cached', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    g.state.events.A = [gev()];
    g.state.transient.add('B');
    const r = await (await handleApi(req('/api/upcoming', bearer(token)), env)).json();
    assert.equal(r.events.length, 1);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM events_cache').get().n, 0);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.deepEqual(me.accounts.map((a) => a.error), [null, null]);
  } finally { g.restore(); }
});

test('cron pushes meetings from a secondary account', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    const NOW = Date.now();
    g.state.events.B = [gev({ id: 'bsoon', iCalUID: 'bsoon', summary: 'From B', start: { dateTime: new Date(NOW + 90e3).toISOString() }, end: { dateTime: new Date(NOW + 1800e3).toISOString() } })];
    env.DB.raw.prepare("INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) SELECT id,'https://push.example/1','a','b',1 FROM users").run();
    const sent = [];
    await runCron(env, NOW, async (e, sub, payload) => { sent.push(payload); return { ok: true }; });
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /^From B starts/);
    assert.ok(token);
  } finally { g.restore(); }
});

test('DELETE /api/me revokes every linked account token and wipes google_accounts', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B });
  try {
    const { token } = await twoAccounts(env, g);
    assert.equal((await handleApi(req('/api/me', bearer(token, { method: 'DELETE' })), env)).status, 200);
    assert.deepEqual(g.revoked.sort(), ['token=rt-A', 'token=rt-B']);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts').get().n, 0);
  } finally { g.restore(); }
});

test('migration 0002 moves each existing user token/email into google_accounts as primary', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users VALUES ('u1','subA','a@x.com','A','pA','v1.enc.a','{}',5)").run();
  db.prepare("INSERT INTO users VALUES ('u2','subB','b@x.com','B','pB',NULL,'{}',6)").run();
  db.exec(readFileSync(new URL('../migrations/0002_google_accounts.sql', import.meta.url), 'utf8'));
  const rows = db.prepare('SELECT * FROM google_accounts ORDER BY user_id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].user_id, 'u1');
  assert.equal(rows[0].google_sub, 'subA');
  assert.equal(rows[0].email, 'a@x.com');
  assert.equal(rows[0].refresh_token_enc, 'v1.enc.a');
  assert.equal(rows[0].added_at, 5);
  assert.equal(rows[0].last_error, null);
  assert.match(rows[0].id, /^[0-9a-f]{32}$/);
  assert.notEqual(rows[0].id, rows[1].id);
});

test('link/complete: replay, wrong user, expiry, bad input, and no bearer', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B, C });
  try {
    const { token: tA } = await signIn(env, 'A');
    const { token: tC } = await signIn(env, 'C');
    // replay: the code works once
    const code = codeOf(await linkCallback(env, tA, 'B'));
    assert.equal((await complete(env, tA, code)).status, 200);
    const replay = await complete(env, tA, code);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'bad_code');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts WHERE user_id = (SELECT id FROM users WHERE google_sub = ?)').get('sub-A').n, 2);

    // mismatch: user C cannot redeem a code minted for user A; nothing attached, code still valid for A
    const idA = env.DB.raw.prepare("SELECT id FROM users WHERE google_sub = 'sub-A'").get().id;
    const code2 = codeOf(await linkCallback(env, tA, 'B')); // re-link of the same account, just to mint a code for A
    const bad = await complete(env, tC, code2);
    assert.equal(bad.status, 403);
    assert.equal((await bad.json()).error, 'link_failed');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM google_accounts WHERE user_id = ?').get(idA).n, 2);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM link_codes').get().n, 1);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM google_accounts WHERE email = 'b@two.com'").get().n, 1);
    assert.equal((await complete(env, tA, code2)).status, 200);

    // expiry: 5 minutes
    const code3 = codeOf(await linkCallback(env, tC, 'A')); // would be account_in_use at complete, but expires first
    env.DB.raw.prepare('UPDATE link_codes SET expires_at = ?').run(Date.now() - 1000);
    const exp = await complete(env, tC, code3);
    assert.equal(exp.status, 400);
    assert.equal((await exp.json()).error, 'code_expired');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM link_codes').get().n, 0);
    const minted = env.DB.raw.prepare('SELECT 1 FROM users').all().length; assert.ok(minted);

    // ttl is 5 minutes
    const code4 = codeOf(await linkCallback(env, tC, 'B'));
    const ttl = env.DB.raw.prepare('SELECT expires_at e FROM link_codes').get().e - Date.now();
    assert.ok(ttl > 290000 && ttl <= 300000, String(ttl));
    assert.ok(code4);

    // bad input / no auth
    assert.equal((await complete(env, tA, 'nope')).status, 400);
    assert.equal((await handleApi(req('/api/accounts/link/complete', { method: 'POST', body: JSON.stringify({}) }), env)).status, 401);
    assert.equal((await handleApi(req('/api/accounts/link/complete', bearer(tA, { method: 'POST', body: '{}' })), env)).status, 400);
  } finally { g.restore(); }
});

test('link (non-web) without calendar scope or a refresh token ends in #error and parks nothing', async () => {
  const env = await makeEnv();
  const g = multiGoogle({ A, B }, { noRefresh: true });
  try {
    const { token } = await signIn(env, 'A');
    const cb = await linkCallback(env, token, 'B');
    assert.equal(cb.headers.get('location'), 'https://abc.chromiumapp.org/cb#error=no_refresh_token');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM link_codes').get().n, 0);
  } finally { g.restore(); }
});

test('cron prunes expired link codes', async () => {
  const env = await makeEnv();
  env.DB.raw.prepare("INSERT INTO link_codes VALUES ('h','u','s','e','n','p','enc', 1)").run();
  await runCron(env, Date.UTC(2026, 9, 25, 10, 0, 0), async () => ({ ok: true }));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM link_codes').get().n, 0);
});
