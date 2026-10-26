const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const sharedCore = path.resolve(__dirname, '../../shared/core.js');
const core = require(fs.existsSync(sharedCore) ? sharedCore : '../stubs/core.js');
const { create } = require('../src/background.js');

const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);

function mock(opts = {}) {
  const store = Object.assign({ token: 'tok', apiBase: 'https://api.test' }, opts.store || {});
  const calls = { exec: [], tabsCreate: [], winCreate: [], winRemove: [], notif: [], notifClear: [], alarms: [], badge: [], fetch: [] };
  const alarms = {};
  const state = { now: T0, win: opts.win === undefined ? { id: 1, focused: true } : opts.win, tabs: opts.tabs || [{ id: 11, url: 'https://example.com/' }] };
  const responses = opts.responses || {};
  const chrome = {
    storage: { local: {
      get: async (keys) => { const o = {}; [].concat(keys).forEach((k) => { if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); }); return o; },
      set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
      remove: async (keys) => { [].concat(keys).forEach((k) => delete store[k]); }
    } },
    action: { setBadgeText: async ({ text }) => { calls.badge.push(text); }, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} },
    alarms: {
      get: async (n) => alarms[n], create: async (n, i) => { alarms[n] = i; calls.alarms.push([n, i]); }, clear: async (n) => { delete alarms[n]; },
      onAlarm: { addListener() {} }
    },
    windows: {
      getLastFocused: async () => { if (!state.win) throw new Error('none'); return state.win; },
      create: async (o) => { calls.winCreate.push(o); return { id: 99 }; },
      remove: async (id) => { calls.winRemove.push(id); }
    },
    tabs: { query: async () => state.tabs, create: async (o) => { calls.tabsCreate.push(o); } },
    scripting: { executeScript: async (o) => { if (opts.execFails) throw new Error('Cannot access'); calls.exec.push(o); } },
    notifications: { create: async (id, o) => { calls.notif.push([id, o]); }, clear: async (id) => { calls.notifClear.push(id); }, onButtonClicked: { addListener() {} }, onClicked: { addListener() {} } },
    identity: { getRedirectURL: (p) => 'https://abc.chromiumapp.org/' + p, launchWebAuthFlow: async ({ url }) => { calls.authUrl = url; return opts.authResult || 'https://abc.chromiumapp.org/cb#token=NEWTOKEN'; } },
    runtime: { getURL: (p) => 'chrome-extension://abc/' + p, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } }
  };
  const fetchFn = async (url, init) => {
    calls.fetch.push({ url, init });
    const p = url.replace('https://api.test', '');
    const r = responses[p] || responses[p.split('?')[0]];
    if (r && r.status) return { status: r.status, ok: r.status < 400, json: async () => r.body || {} };
    return { status: 200, ok: true, json: async () => r };
  };
  const bg = create({ chrome, core, fetch: fetchFn, now: () => state.now, setTimeout: (fn) => fn() });
  return { bg, chrome, store, calls, state, alarms };
}

const ev = (over = {}) => Object.assign({ key: 'k1', id: 'e1', title: 'Quick sync', start: T0 + 90000, end: T0 + 90000 + 1800000, link: 'https://meet.google.com/abc', provider: 'meet', calendar: 'a@b.c', attendees: 'with Miles and 3 others', attendeeCount: 5, isMeeting: true, allDay: false, declined: false }, over);
const upcoming = (events) => ({ '/api/upcoming': { now: T0, events }, '/api/me': { email: 'a@b.c', name: 'A', settings: {} } });

test('tick injects reminder into the active tab (two scripts) and posts a notification', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  const r = await m.bg.tick();
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].where, 'tab');
  assert.equal(m.calls.exec.length, 2);
  assert.equal(m.calls.exec[0].target.tabId, 11);
  assert.equal(m.calls.exec[0].args[0].event.key, 'k1');
  assert.equal(m.calls.exec[0].args[0].mode, 'flyby');
  assert.deepEqual(m.calls.exec[1].files, ['reminder.iife.js', 'launcher.js']);
  assert.equal(m.calls.notif.length, 1);
  assert.equal(m.calls.notif[0][1].buttons[0].title, 'Join on Meet');
  assert.equal(m.calls.winCreate.length, 0);
});

test('tick sends Bearer token to /api/upcoming and /api/me', async () => {
  const m = mock({ responses: upcoming([]) });
  await m.bg.tick();
  const urls = m.calls.fetch.map((c) => c.url).sort();
  assert.deepEqual(urls, ['https://api.test/api/me', 'https://api.test/api/upcoming']);
  m.calls.fetch.forEach((c) => assert.equal(c.init.headers.Authorization, 'Bearer tok'));
});

test('does not fire twice for the same event', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  m.state.now += 60000;
  const r = await m.bg.tick();
  assert.equal(r.shown.length, 0);
  assert.equal(m.calls.exec.length, 2);
});

test('not due yet: nothing shown, badge shows minutes', async () => {
  const m = mock({ responses: upcoming([ev({ start: T0 + 25 * 60000 - 1000 })]) });
  const r = await m.bg.tick();
  assert.equal(r.shown.length, 0);
  assert.equal(m.calls.badge.at(-1), '25');
});

test('badge cleared when next meeting is more than 60 minutes away', async () => {
  const m = mock({ responses: upcoming([ev({ start: T0 + 3 * 3600000 })]) });
  await m.bg.tick();
  assert.equal(m.calls.badge.at(-1), '');
});

test('non-meeting solo events are ignored (meetingsOnly)', async () => {
  const solo = ev({ key: 'solo', link: '', attendeeCount: 1, attendees: '', isMeeting: false });
  const m = mock({ responses: upcoming([solo]) });
  const r = await m.bg.tick();
  assert.equal(r.shown.length, 0);
});

test('un-scriptable tab (chrome://) falls back to a popup window', async () => {
  const m = mock({ tabs: [{ id: 5, url: 'chrome://extensions' }], responses: upcoming([ev()]) });
  const r = await m.bg.tick();
  assert.equal(r.shown[0].where, 'window');
  assert.equal(m.calls.exec.length, 0);
  assert.equal(m.calls.winCreate[0].type, 'popup');
  assert.match(m.calls.winCreate[0].url, /reminder\.html$/);
  assert.equal(m.store.current.event.key, 'k1');
});

test('Chrome Web Store tab is un-scriptable', async () => {
  const m = mock({ tabs: [{ id: 5, url: 'https://chromewebstore.google.com/detail/x' }], responses: upcoming([ev()]) });
  assert.equal((await m.bg.tick()).shown[0].where, 'window');
});

test('no focused window falls back to a popup window', async () => {
  const m = mock({ win: { id: 1, focused: false }, responses: upcoming([ev()]) });
  assert.equal((await m.bg.tick()).shown[0].where, 'window');
  const m2 = mock({ win: null, responses: upcoming([ev({ key: 'k2' })]) });
  assert.equal((await m2.bg.tick()).shown[0].where, 'window');
});

test('executeScript failure (e.g. PDF viewer) falls back to a popup window', async () => {
  const m = mock({ execFails: true, responses: upcoming([ev()]) });
  assert.equal((await m.bg.tick()).shown[0].where, 'window');
});

test('takeover style is passed to the reminder', async () => {
  const r = upcoming([ev()]); r['/api/me'].settings = { style: 'takeover' };
  const m = mock({ responses: r });
  await m.bg.tick();
  assert.equal(m.calls.exec[0].args[0].mode, 'takeover');
});

test('join opens the link, clears notification and the snooze alarm', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  await m.bg.onMessage({ type: 'join', event: ev() });
  assert.deepEqual(m.calls.tabsCreate, [{ url: 'https://meet.google.com/abc' }]);
  assert.deepEqual(m.calls.notifClear, ['mpz:k1']);
});

test('join without a link opens nothing', async () => {
  const m = mock({});
  await m.bg.onMessage({ type: 'join', event: ev({ link: '' }) });
  assert.equal(m.calls.tabsCreate.length, 0);
});

test('snooze schedules a 60 s alarm that re-fires the reminder', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  await m.bg.onMessage({ type: 'snooze', event: ev() });
  const a = m.calls.alarms.find((c) => c[0] === 'mpz-snooze:k1');
  assert.ok(a);
  assert.equal(a[1].delayInMinutes, 1);
  m.state.now += 60000;
  const r = await m.bg.onAlarm({ name: 'mpz-snooze:k1' });
  assert.equal(r.where, 'tab');
  assert.equal(m.calls.exec.length, 4);
});

test('snooze alarm for an old event is dropped', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  await m.bg.onMessage({ type: 'snooze', event: ev() });
  m.state.now += 2 * 3600000;
  const r = await m.bg.onAlarm({ name: 'mpz-snooze:k1' });
  assert.equal(r.skipped, 'stale');
});

test('dismiss forgets the event; snooze alarm then does nothing', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  await m.bg.onMessage({ type: 'dismiss', event: ev() });
  const r = await m.bg.onAlarm({ name: 'mpz-snooze:k1' });
  assert.equal(r.skipped, 'gone');
});

test('401 signs the user out and clears the badge', async () => {
  const m = mock({ responses: { '/api/upcoming': { status: 401 }, '/api/me': { status: 401 } } });
  const r = await m.bg.tick();
  assert.equal(r.skipped, 'unauthorized');
  assert.equal(m.store.token, undefined);
  assert.equal(m.calls.badge.at(-1), '');
});

test('offline fetch falls back to cached events', async () => {
  const m = mock({ store: { events: [ev()], me: { settings: {} } }, responses: {} });
  const orig = m.calls.fetch;
  const m2 = mock({ store: { events: [ev()], me: { settings: {} } } });
  // make every fetch reject
  const bg = create({ chrome: m2.chrome, core, fetch: async () => { throw new Error('offline'); }, now: () => m2.state.now, setTimeout: (f) => f() });
  const r = await bg.tick();
  assert.equal(r.shown.length, 1);
});

test('signed out: tick does nothing', async () => {
  const m = mock({ store: { token: undefined } });
  delete m.store.token;
  assert.deepEqual(await m.bg.tick(), { skipped: 'signed-out' });
  assert.equal(m.calls.fetch.length, 0);
});

test('signIn builds the auth URL with the chromiumapp redirect and stores the token', async () => {
  const m = mock({ store: { token: undefined }, responses: upcoming([]) });
  delete m.store.token;
  const r = await m.bg.signIn();
  assert.equal(r.signedIn, true);
  assert.equal(m.store.token, 'NEWTOKEN');
  assert.match(m.calls.authUrl, /^https:\/\/api\.test\/api\/auth\/google\/start\?client=ext&return=https%3A%2F%2Fabc\.chromiumapp\.org%2Fcb$/);
});

test('signIn without a token in the redirect throws', async () => {
  const m = mock({ authResult: 'https://abc.chromiumapp.org/cb#error=denied' });
  await assert.rejects(() => m.bg.signIn(), /No token/);
});

test('saveSettings PUTs a partial and updates the cached settings', async () => {
  const m = mock({ store: { me: { email: 'a@b.c', settings: {} } }, responses: { '/api/settings': { leadSeconds: 300, style: 'takeover' } } });
  const r = await m.bg.saveSettings({ leadSeconds: 300 });
  const put = m.calls.fetch.find((c) => c.url.endsWith('/api/settings'));
  assert.equal(put.init.method, 'PUT');
  assert.deepEqual(JSON.parse(put.init.body), { leadSeconds: 300 });
  assert.equal(r.settings.leadSeconds, 300);
});

test('signOut calls /api/logout and clears local state', async () => {
  const m = mock({ responses: { '/api/logout': { ok: true } } });
  await m.bg.signOut();
  assert.ok(m.calls.fetch.some((c) => c.url.endsWith('/api/logout') && c.init.method === 'POST'));
  assert.equal(m.store.token, undefined);
});

test('test reminder shows a fake meeting in the active tab', async () => {
  const m = mock({ store: { me: { email: 'a@b.c', settings: {} } } });
  const r = await m.bg.testReminder(2000);
  assert.equal(r.where, 'tab');
  assert.equal(m.calls.exec[0].args[0].event.title, 'Quick sync');
  assert.equal(m.calls.exec[0].args[0].event.link, 'https://meet.google.com/');
});

test('getState returns next meeting and minutes', async () => {
  const m = mock({ responses: upcoming([ev({ start: T0 + 10 * 60000 })]) });
  const s = await m.bg.getState(true);
  assert.equal(s.signedIn, true);
  assert.equal(s.next.key, 'k1');
  assert.equal(s.minutes, 10);
  const m2 = mock({ store: { token: undefined } }); delete m2.store.token;
  assert.equal((await m2.bg.getState()).signedIn, false);
});

test('ensureAlarm creates a 1 minute periodic alarm once', async () => {
  const m = mock({});
  await m.bg.ensureAlarm(); await m.bg.ensureAlarm();
  assert.equal(m.calls.alarms.filter((c) => c[0] === 'mpz-tick').length, 1);
  assert.equal(m.alarms['mpz-tick'].periodInMinutes, 1);
});

test('notification Join button opens the meeting link', async () => {
  const m = mock({ responses: upcoming([ev()]) });
  await m.bg.tick();
  await m.bg.onNotifButton('mpz:k1', 0);
  assert.deepEqual(m.calls.tabsCreate, [{ url: 'https://meet.google.com/abc' }]);
});

test('manifest is valid MV3 with a fixed key and required permissions', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/manifest.json'), 'utf8'));
  assert.equal(mf.manifest_version, 3);
  assert.ok(mf.key && mf.key.length > 200);
  ['identity', 'alarms', 'storage', 'scripting', 'notifications'].forEach((p) => assert.ok(mf.permissions.includes(p), p));
  assert.ok(mf.host_permissions.includes('<all_urls>'));
  const id = fs.readFileSync(path.join(__dirname, '../EXTENSION_ID.txt'), 'utf8').trim();
  const der = Buffer.from(mf.key, 'base64');
  const h = require('crypto').createHash('sha256').update(der).digest('hex').slice(0, 32);
  const computed = h.replace(/[0-9a-f]/g, (c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));
  assert.equal(computed, id);
});

test('addAccount asks the server for a link URL, runs the auth flow with the chromiumapp return, refreshes /api/me', async () => {
  const m = mock({
    authResult: 'https://abc.chromiumapp.org/cb#link_code=CODE123',
    responses: Object.assign(upcoming([]), {
      '/api/accounts/link': { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' },
      '/api/accounts/link/complete': { ok: true }
    })
  });
  const r = await m.bg.addAccount();
  assert.equal(r.ok, true);
  const link = m.calls.fetch.find((c) => c.url.endsWith('/api/accounts/link'));
  assert.equal(link.init.method, 'POST');
  assert.deepEqual(JSON.parse(link.init.body), { client: 'ext', return: 'https://abc.chromiumapp.org/cb' });
  assert.equal(m.calls.authUrl, 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
  const comp = m.calls.fetch.find((c) => c.url.endsWith('/api/accounts/link/complete'));
  assert.equal(comp.init.method, 'POST');
  assert.equal(comp.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(comp.init.body), { code: 'CODE123' });
  assert.ok(m.calls.fetch.indexOf(comp) < m.calls.fetch.findIndex((c) => c.url.endsWith('/api/me')), 'completes before refreshing');
});

test('addAccount surfaces #error= from the redirect and fails without #link_code', async () => {
  const resp = Object.assign(upcoming([]), { '/api/accounts/link': { url: 'https://accounts.google.com/x' } });
  const a = mock({ authResult: 'https://abc.chromiumapp.org/cb#error=account_in_use', responses: resp });
  await assert.rejects(() => a.bg.addAccount(), /account_in_use/);
  const b = mock({ authResult: 'https://abc.chromiumapp.org/cb', responses: resp });
  await assert.rejects(() => b.bg.addAccount(), /not linked/);
  const c = mock({ authResult: 'https://abc.chromiumapp.org/cb#link_code=X', responses: Object.assign(resp, { '/api/accounts/link/complete': { status: 409, body: { error: 'account_in_use' } } }) });
  await assert.rejects(() => c.bg.addAccount(), /http 409/);
});

test('removeAccount DELETEs the account and refreshes', async () => {
  const m = mock({ responses: Object.assign(upcoming([]), { '/api/accounts/abc123': { ok: true } }) });
  const r = await m.bg.removeAccount('abc123');
  assert.equal(r.ok, true);
  const del = m.calls.fetch.find((c) => c.url.endsWith('/api/accounts/abc123'));
  assert.equal(del.init.method, 'DELETE');
  assert.equal(del.init.headers.Authorization, 'Bearer tok');
});
