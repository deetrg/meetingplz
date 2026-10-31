import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { statsPage } from '../src/api.js';
import { _resetLimiter } from '../src/metrics.js';
import { _resetReleaseCache } from '../src/stats.js';
import { makeEnv, googleMock, mockFetch, jsonRes, idToken } from './helpers.js';

const WEB = 'https://meetingplz.nonolingo.com';
const reqWeb = (path, init = {}) => new Request(WEB + path, init);
const post = (body, headers = {}) => reqWeb('/api/m', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
const rows = (env, where = '1=1') => env.DB.raw.prepare(`SELECT name, client, ref, count FROM metrics WHERE ${where} ORDER BY name, client, ref`).all().map((r) => ({ ...r }));

// Google mock + GitHub releases, one fetch handler.
function mocks(opts = {}) {
  const g = googleMock(opts);
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.github.com/')) {
      calls.push(String(url));
      return jsonRes([{ tag_name: 'v1.0.0', published_at: '2026-10-30T00:00:00Z', assets: [{ name: 'MeetingPlz-mac.dmg', download_count: 7 }, { name: 'MeetingPlz-windows-setup.exe', download_count: 3 }] }]);
    }
    return real(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = real; g.restore(); } };
}

async function webSignIn(env, { ref = '', sub, email } = {}) {
  const start = await handleApi(reqWeb(`/api/auth/google/start?client=web${ref ? '&ref=' + ref : ''}`), env);
  const loc = new URL(start.headers.get('location'));
  const n = start.headers.get('set-cookie').match(/(mp_oauth_[^=]+)=([^;]+)/);
  const cb = await handleApi(reqWeb(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { headers: { cookie: `${n[1]}=${n[2]}` } }), env);
  const sc = (cb.headers.getSetCookie() || []).find((c) => c.startsWith('mp_session='));
  return { cb, cookie: sc ? sc.split(';')[0] : '' };
}

test('POST /api/m upserts and increments, sets no cookie, stores no user data', async () => {
  _resetLimiter();
  const env = await makeEnv();
  const r1 = await handleApi(post({ name: 'landing_view', client: 'web', ref: 'QA' }), env);
  assert.equal(r1.status, 204);
  assert.equal(r1.headers.get('set-cookie'), null);
  await handleApi(post({ name: 'landing_view', client: 'web', ref: 'qa' }), env);
  await handleApi(post({ name: 'reminder_shown', client: 'ios', ref: '' }), env);
  assert.deepEqual(rows(env), [
    { name: 'landing_view', client: 'web', ref: 'qa', count: 2 },
    { name: 'reminder_shown', client: 'ios', ref: '', count: 1 },
  ]);
  const cols = env.DB.raw.prepare('PRAGMA table_info(metrics)').all().map((c) => c.name);
  assert.deepEqual(cols, ['day', 'name', 'client', 'ref', 'count']);
});

test('POST /api/m accepts text/plain beacons, cleans ref, falls back to client web', async () => {
  _resetLimiter();
  const env = await makeEnv();
  const r = await handleApi(post(JSON.stringify({ name: 'download_click_mac', client: 'nope', ref: 'Bad Ref!<script>' }), { 'content-type': 'text/plain' }), env);
  assert.equal(r.status, 204);
  assert.deepEqual(rows(env), [{ name: 'download_click_mac', client: 'web', ref: '', count: 1 }]);
});

test('POST /api/m allow-list: unknown and server-only names are rejected, bad bodies too', async () => {
  _resetLimiter();
  const env = await makeEnv();
  for (const name of ['signin_ok', 'user_created', 'first_upcoming', 'consent_missing', 'evil', '', undefined, 5]) {
    assert.equal((await handleApi(post({ name, client: 'web' }), env)).status, 400, String(name));
  }
  assert.equal((await handleApi(post('not json'), env)).status, 400);
  assert.equal((await handleApi(post('x'.repeat(600)), env)).status, 413);
  assert.equal((await handleApi(reqWeb('/api/m'), env)).status, 404); // GET is not a route
  assert.deepEqual(rows(env), []);
  for (const name of ['landing_view', 'download_click_mac', 'download_click_win', 'download_click_chrome', 'download_click_iphone', 'web_signin_start', 'demo_start', 'reminder_shown', 'test_reminder']) {
    assert.equal((await handleApi(post({ name, client: 'web' }), env)).status, 204, name);
  }
  assert.equal(rows(env).length, 9);
});

test('POST /api/m rate-limits per caller (still 204, no write)', async () => {
  _resetLimiter();
  const env = await makeEnv();
  for (let i = 0; i < 60; i++) assert.equal((await handleApi(post({ name: 'demo_start', client: 'web' }, { 'cf-connecting-ip': '1.2.3.4' }), env)).status, 204);
  assert.equal(rows(env)[0].count, 40);
  // another caller is unaffected
  await handleApi(post({ name: 'demo_start', client: 'web' }, { 'cf-connecting-ip': '5.6.7.8' }), env);
  assert.equal(rows(env)[0].count, 41);
  _resetLimiter();
});

test('server-side funnel: signin_ok + user_created by ref, first_upcoming once, consent_missing', async () => {
  _resetLimiter();
  const env = await makeEnv();
  const m = mocks();
  try {
    const { cb, cookie } = await webSignIn(env, { ref: 'Twitter' });
    assert.equal(cb.headers.get('location'), '/app');
    assert.deepEqual(rows(env), [{ name: 'signin_ok', client: 'web', ref: 'twitter', count: 1 }, { name: 'user_created', client: 'web', ref: 'twitter', count: 1 }]);
    assert.equal(env.DB.raw.prepare('SELECT ref FROM users').get().ref, 'twitter');

    for (let i = 0; i < 2; i++) assert.equal((await handleApi(reqWeb('/api/upcoming', { headers: { cookie } }), env)).status, 200);
    assert.deepEqual(rows(env, "name='first_upcoming'"), [{ name: 'first_upcoming', client: 'web', ref: 'twitter', count: 1 }]);

    // returning user: another sign-in, but no new user_created
    await webSignIn(env, { ref: 'x' });
    assert.equal(rows(env, "name='user_created'")[0].count, 1);
    assert.equal(rows(env, "name='signin_ok'").reduce((a, r) => a + r.count, 0), 2);
  } finally { m.restore(); }

  const env2 = await makeEnv();
  const m2 = mocks({ scope: 'openid email profile' });
  try {
    const { cb } = await webSignIn(env2, { ref: 'hn' });
    assert.equal(cb.headers.get('location'), '/app?error=calendar_access_needed');
    assert.deepEqual(rows(env2), [{ name: 'consent_missing', client: 'web', ref: 'hn', count: 1 }]);
  } finally { m2.restore(); }
});

test('admin gate: /api/admin/stats and /stats only for daitq3010@gmail.com', async () => {
  _resetLimiter(); _resetReleaseCache();
  const env = await makeEnv();
  // anonymous
  assert.equal((await handleApi(reqWeb('/api/admin/stats'), env)).status, 401);
  assert.equal((await statsPage(reqWeb('/stats'), env)).status, 404);

  const m = mocks({ sub: 'sub-user', email: 'someone@example.com' });
  try {
    const user = await webSignIn(env, { ref: 'launch' });
    assert.equal((await handleApi(reqWeb('/api/admin/stats', { headers: { cookie: user.cookie } }), env)).status, 404);
    assert.equal((await statsPage(reqWeb('/stats', { headers: { cookie: user.cookie } }), env)).status, 404);
  } finally { m.restore(); }

  const m2 = mocks({ sub: 'sub-admin', email: 'daitq3010@gmail.com' });
  try {
    const admin = await webSignIn(env, { ref: 'qa' });
    await handleApi(post({ name: 'landing_view', client: 'web', ref: 'qa' }), env);
    // an own-team user must not count
    env.DB.raw.prepare("INSERT INTO users (id, google_sub, email, settings_json, created_at) VALUES ('t1','s-t1','x@nonolingo.com','{}',?)").run(Date.now());
    const res = await handleApi(reqWeb('/api/admin/stats', { headers: { cookie: admin.cookie } }), env);
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.days.length, 7);
    assert.equal(s.totals.landing_view, 1);
    assert.equal(s.byRef.qa.landing_view, 1);
    assert.equal(s.users.total, 1, 'only sub-user counts; admin and @nonolingo.com are excluded');
    assert.equal(s.users.linkedAccounts, 1);
    assert.equal(s.github.total, 10);
    const html = await statsPage(reqWeb('/stats', { headers: { cookie: admin.cookie } }), env);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.equal(html.headers.get('cache-control'), 'no-store');
    const text = await html.text();
    assert.match(text, /MeetingPlz stats/);
    assert.match(text, /noindex/);
    // GitHub response is cached for 10 minutes
    assert.equal(m2.calls.length, 1);
  } finally { m2.restore(); }
});
