import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, validReturn, corsHeaders } from '../src/api.js';
import { mapEvents, attendeeText } from '../src/events.js';
import { makeEnv, googleMock } from './helpers.js';

const ORIGIN = 'https://meetingplz.pages.dev';
const req = (path, init = {}) => new Request(ORIGIN + path, init);
const bearer = (t, extra = {}) => ({ headers: { authorization: `Bearer ${t}`, ...(extra.headers || {}) }, ...extra, });

async function signIn(env, { client = 'ext', ret = 'https://abc.chromiumapp.org/cb' } = {}) {
  const start = await handleApi(req(`/api/auth/google/start?client=${client}&return=${encodeURIComponent(ret)}`), env);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(loc.searchParams.get('access_type'), 'offline');
  assert.equal(loc.searchParams.get('prompt'), 'consent');
  assert.ok(loc.searchParams.get('scope').includes('calendar.readonly'));
  assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/google/callback`);
  const nonce = start.headers.get('set-cookie').match(/mp_oauth=([^;]+)/)[1];
  const cb = await handleApi(req(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { headers: { cookie: `mp_oauth=${nonce}` } }), env);
  return cb;
}

test('return URL validation', () => {
  assert.ok(validReturn('ext', 'https://abcdef.chromiumapp.org/cb'));
  assert.ok(validReturn('desktop', 'http://127.0.0.1:5123/cb'));
  assert.ok(validReturn('ios', 'meetingplz://auth'));
  assert.ok(validReturn('web', ''));
  assert.ok(!validReturn('ext', 'https://evil.com/cb'));
  assert.ok(!validReturn('ext', 'https://abc.chromiumapp.org.evil.com/cb'));
  assert.ok(!validReturn('desktop', 'http://localhost:5123/cb'));
  assert.ok(!validReturn('desktop', 'http://127.0.0.1/cb'));
  assert.ok(!validReturn('ios', 'meetingplz://other'));
  assert.ok(!validReturn('ios', ''));
});

test('cors allowlist', () => {
  assert.ok(corsHeaders('chrome-extension://' + 'a'.repeat(32)));
  assert.ok(corsHeaders('tauri://localhost'));
  assert.ok(corsHeaders('http://tauri.localhost'));
  assert.ok(corsHeaders('capacitor://localhost'));
  assert.ok(corsHeaders('http://127.0.0.1:9999'));
  assert.equal(corsHeaders('https://evil.com'), null);
  assert.equal(corsHeaders(null), null);
});

test('sign-in for extension returns token in fragment; me/settings/logout work', async () => {
  const env = await makeEnv();
  const g = googleMock();
  try {
    const cb = await signIn(env);
    assert.equal(cb.status, 302);
    const loc = cb.headers.get('location');
    assert.ok(loc.startsWith('https://abc.chromiumapp.org/cb#token='));
    const token = loc.split('#token=')[1];

    const stored = env.DB.raw.prepare('SELECT * FROM users').get();
    assert.equal(stored.email, 'a@b.com');
    assert.ok(stored.refresh_token_enc.startsWith('v1.'));
    assert.ok(!stored.refresh_token_enc.includes('rt-1'));
    assert.equal(env.DB.raw.prepare('SELECT token_hash FROM sessions').get().token_hash.includes(token), false);

    assert.equal((await handleApi(req('/api/me'), env)).status, 401);
    const me = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.equal(me.email, 'a@b.com');
    assert.deepEqual(me.settings, { leadSeconds: 120, style: 'flyby', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 });

    const put = await handleApi(req('/api/settings', bearer(token, { method: 'PUT', body: JSON.stringify({ leadSeconds: 300, style: 'takeover', alarm: 'nope', bogus: 1 }) })), env);
    const s = await put.json();
    assert.equal(s.leadSeconds, 300);
    assert.equal(s.style, 'takeover');
    assert.equal(s.alarm, 'jingle');
    const me2 = await (await handleApi(req('/api/me', bearer(token)), env)).json();
    assert.equal(me2.settings.leadSeconds, 300);
    assert.equal((await handleApi(req('/api/settings', bearer(token, { method: 'PUT', body: '"x"' })), env)).status, 400);

    assert.equal((await handleApi(req('/api/logout', bearer(token, { method: 'POST' })), env)).status, 200);
    assert.equal((await handleApi(req('/api/me', bearer(token)), env)).status, 401);
  } finally { g.restore(); }
});

test('web sign-in sets an HttpOnly session cookie and redirects to /app; cookie writes need same Origin', async () => {
  const env = await makeEnv();
  const g = googleMock();
  try {
    const cb = await signIn(env, { client: 'web', ret: '' });
    assert.equal(cb.headers.get('location'), '/app');
    const sc = cb.headers.getSetCookie().find((c) => c.startsWith('mp_session='));
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /Secure/);
    const cookie = sc.split(';')[0];
    assert.equal((await handleApi(req('/api/me', { headers: { cookie } }), env)).status, 200);
    const noOrigin = await handleApi(req('/api/settings', { method: 'PUT', headers: { cookie }, body: '{"leadSeconds":60}' }), env);
    assert.equal(noOrigin.status, 401);
    const evil = await handleApi(req('/api/settings', { method: 'PUT', headers: { cookie, origin: 'https://evil.com' }, body: '{"leadSeconds":60}' }), env);
    assert.equal(evil.status, 401);
    const ok = await handleApi(req('/api/settings', { method: 'PUT', headers: { cookie, origin: ORIGIN }, body: '{"leadSeconds":60}' }), env);
    assert.equal(ok.status, 200);
  } finally { g.restore(); }
});

test('callback rejects bad state, missing nonce cookie, and missing calendar scope', async () => {
  const env = await makeEnv();
  const g = googleMock();
  try {
    assert.equal((await handleApi(req('/api/auth/google/callback?code=x&state=bad.sig'), env)).status, 400);
    const start = await handleApi(req('/api/auth/google/start?client=web'), env);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    assert.equal((await handleApi(req(`/api/auth/google/callback?code=x&state=${encodeURIComponent(state)}`), env)).status, 400);
    g.restore();
    const g2 = googleMock({ scope: 'openid email profile' });
    const nonce = start.headers.get('set-cookie').match(/mp_oauth=([^;]+)/)[1];
    const r = await handleApi(req(`/api/auth/google/callback?code=x&state=${encodeURIComponent(state)}`, { headers: { cookie: `mp_oauth=${nonce}` } }), env);
    assert.equal(r.headers.get('location'), '/app?error=calendar_access_needed');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    g2.restore();
  } finally { g.restore(); }
});

test('start rejects unknown client and bad return', async () => {
  const env = await makeEnv();
  assert.equal((await handleApi(req('/api/auth/google/start?client=zzz'), env)).status, 400);
  assert.equal((await handleApi(req('/api/auth/google/start?client=ext&return=https://evil.com/'), env)).status, 400);
});

const T0 = Date.now() + 3600e3;
const gev = (over) => ({
  id: 'e1', iCalUID: 'e1@google.com', status: 'confirmed', summary: 'Quick sync',
  start: { dateTime: new Date(T0).toISOString() }, end: { dateTime: new Date(T0 + 3600e3).toISOString() },
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  organizer: { email: 'miles@x.com', self: false },
  attendees: [{ email: 'a@b.com', self: true, responseStatus: 'accepted' }, { email: 'miles@x.com', displayName: 'Miles Ng' }, { email: 'c@x.com' }, { email: 'd@x.com' }, { email: 'e@x.com' }],
  ...over,
});

test('mapEvents: shape, attendee text, filtering flags, dedupe', () => {
  const list = mapEvents([
    { calendarId: 'a@b.com', items: [gev(), gev({ id: 'e2', iCalUID: 'e2', summary: 'Focus', hangoutLink: undefined, attendees: undefined, organizer: { email: 'a@b.com', self: true }, eventType: 'focusTime' }),
      gev({ id: 'e3', iCalUID: 'e3', summary: 'Declined', attendees: [{ email: 'a@b.com', self: true, responseStatus: 'declined' }, { email: 'm@x.com' }] }),
      gev({ id: 'e4', iCalUID: 'e4', status: 'cancelled' }),
      gev({ id: 'e5', iCalUID: 'e5', summary: 'Holiday', start: { date: '2026-10-26' }, end: { date: '2026-10-27' }, hangoutLink: undefined, attendees: undefined })] },
    { calendarId: 'other@x.com', items: [gev()] },
  ]);
  assert.equal(list.length, 4);
  const e1 = list.find((e) => e.id === 'e1');
  assert.equal(e1.attendees, 'with Miles and 3 others');
  assert.equal(e1.link, 'https://meet.google.com/abc-defg-hij');
  assert.equal(e1.provider, 'meet');
  assert.equal(e1.calendar, 'a@b.com');
  assert.equal(e1.isMeeting, true);
  assert.equal(typeof e1.start, 'number');
  assert.equal(list.find((e) => e.id === 'e2').isMeeting, false);
  assert.equal(list.find((e) => e.id === 'e3').declined, true);
  assert.equal(list.find((e) => e.id === 'e3').isMeeting, false);
  assert.equal(list.find((e) => e.id === 'e5').allDay, true);
  assert.equal(list.find((e) => e.id === 'e5').isMeeting, false);
  assert.ok(!list.find((e) => e.id === 'e4'));
  assert.equal(attendeeText([{ self: true }, { email: 'zed@x.com' }]), 'with zed');
  assert.equal(attendeeText([{ self: true }]), '');
});

test('/api/upcoming returns real-shaped data and caches 90 s in D1', async () => {
  const env = await makeEnv();
  const g = googleMock({ events: [gev()] });
  try {
    const token = (await signIn(env)).headers.get('location').split('#token=')[1];
    const r = await (await handleApi(req('/api/upcoming', bearer(token)), env)).json();
    assert.equal(typeof r.now, 'number');
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].title, 'Quick sync');
    const eventCalls = () => g.calls.filter((c) => c.url.includes('/events?')).length;
    assert.equal(eventCalls(), 1); // holiday calendar skipped
    await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(eventCalls(), 1); // cache hit
    env.DB.raw.prepare('UPDATE events_cache SET fetched_at = fetched_at - 100000').run();
    await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(eventCalls(), 2);
  } finally { g.restore(); }
});

test('/api/upcoming returns 401 reauth when Google revokes the refresh token', async () => {
  const env = await makeEnv();
  const g = googleMock();
  let token;
  try { token = (await signIn(env)).headers.get('location').split('#token=')[1]; } finally { g.restore(); }
  const { mockFetch, jsonRes } = await import('./helpers.js');
  const m = mockFetch(() => jsonRes({ error: 'invalid_grant' }, 400));
  try {
    const r = await handleApi(req('/api/upcoming', bearer(token)), env);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'reauth');
  } finally { m.restore(); }
});

test('push subscribe / unsubscribe / vapid / test-reminder', async () => {
  const env = await makeEnv();
  const g = googleMock();
  try {
    const token = (await signIn(env)).headers.get('location').split('#token=')[1];
    const vap = await (await handleApi(req('/api/push/vapid'), env)).json();
    assert.equal(vap.publicKey, env.VAPID_PUBLIC_KEY);
    assert.equal((await handleApi(req('/api/test-reminder', bearer(token, { method: 'POST' })), env)).status, 400);
    const bad = await handleApi(req('/api/push/subscribe', bearer(token, { method: 'POST', body: JSON.stringify({ endpoint: 'http://x', keys: {} }) })), env);
    assert.equal(bad.status, 400);
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'AAAA', auth: 'BBBB' } };
    assert.equal((await handleApi(req('/api/push/subscribe', bearer(token, { method: 'POST', body: JSON.stringify(sub) })), env)).status, 200);
    await handleApi(req('/api/push/subscribe', bearer(token, { method: 'POST', body: JSON.stringify(sub) })), env);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 1);

    const sent = [];
    env.__send = async (e, s, payload) => { sent.push({ s, payload }); return { ok: true, status: 201 }; };
    let waited;
    const ctx = { waitUntil: (p) => { waited = p; } };
    const t = await handleApi(req('/api/test-reminder', bearer(token, { method: 'POST' })), env, ctx);
    assert.equal(t.status, 200);
    await waited;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.title, 'Join the meeting.');
    assert.equal(sent[0].payload.actions.length, 2);

    assert.equal((await handleApi(req('/api/push/subscribe', bearer(token, { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) })), env)).status, 200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 0);
  } finally { g.restore(); }
});

test('DELETE /api/me and /api/account wipe the user, revoke the Google token', async () => {
  for (const path of ['/api/me', '/api/account']) {
    const env = await makeEnv();
    const g = googleMock({ events: [gev()] });
    try {
      const token = (await signIn(env)).headers.get('location').split('#token=')[1];
      await handleApi(req('/api/upcoming', bearer(token)), env);
      await handleApi(req('/api/push/subscribe', bearer(token, { method: 'POST', body: JSON.stringify({ endpoint: 'https://p/e', keys: { p256dh: 'a', auth: 'b' } }) })), env);
      env.DB.raw.prepare("INSERT INTO fired VALUES (?, 'k', 1)").run(env.DB.raw.prepare('SELECT id FROM users').get().id);
      const r = await handleApi(req(path, bearer(token, { method: 'DELETE' })), env);
      assert.equal(r.status, 200);
      for (const t of ['users', 'sessions', 'push_subs', 'events_cache', 'fired', 'snoozes']) {
        assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
      }
      const rev = g.calls.find((c) => c.url === 'https://oauth2.googleapis.com/revoke');
      assert.ok(rev);
      assert.equal(String(rev.init.body), 'token=rt-1');
    } finally { g.restore(); }
  }
});

test('unknown route 404, OPTIONS preflight gets CORS', async () => {
  const env = await makeEnv();
  assert.equal((await handleApi(req('/api/nope'), env)).status, 404);
  const o = await handleApi(req('/api/me', { method: 'OPTIONS', headers: { origin: 'tauri://localhost' } }), env);
  assert.equal(o.status, 204);
  assert.equal(o.headers.get('access-control-allow-origin'), 'tauri://localhost');
});
