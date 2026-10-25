/* MeetingPlz background service worker (MV3, classic script).
 * All logic lives in create({...}) so it can be unit-tested with a mocked chrome object. */
(function (root) {
  var API_DEFAULT = 'https://meetingplz.pages.dev';
  var TICK = 'mpz-tick';
  var SNOOZE = 'mpz-snooze:';
  var NOTIF_PREFIX = 'mpz:';
  var STALE_MS = 30 * 60 * 1000;

  function create(deps) {
    var chrome = deps.chrome;
    var core = deps.core;
    var doFetch = deps.fetch;
    var now = deps.now || function () { return Date.now(); };
    var wait = deps.setTimeout || setTimeout;

    var get = function (keys) { return chrome.storage.local.get(keys); };
    var set = function (obj) { return chrome.storage.local.set(obj); };

    function scriptable(url) {
      if (!url) return false;
      if (!/^(https?|file):/i.test(url)) return false;
      if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) return false;
      return true;
    }

    async function apiBase() {
      var s = await get(['apiBase']);
      return s.apiBase || API_DEFAULT;
    }

    // Authenticated JSON call. Throws {status} on HTTP error. 401 signs the user out.
    async function api(path, opts) {
      var s = await get(['token', 'apiBase']);
      if (!s.token) { var e0 = new Error('signed out'); e0.status = 401; throw e0; }
      var o = opts || {};
      var headers = { Authorization: 'Bearer ' + s.token };
      if (o.body) headers['Content-Type'] = 'application/json';
      var res = await doFetch((s.apiBase || API_DEFAULT) + path, {
        method: o.method || 'GET',
        headers: headers,
        body: o.body ? JSON.stringify(o.body) : undefined
      });
      if (res.status === 401) { await signOutLocal(); var e1 = new Error('unauthorized'); e1.status = 401; throw e1; }
      if (!res.ok) { var e2 = new Error('http ' + res.status); e2.status = res.status; throw e2; }
      return res.json();
    }

    async function signOutLocal() {
      await chrome.storage.local.remove(['token', 'me', 'events', 'eventsAt', 'active']);
      await setBadge('');
    }

    async function setBadge(text) {
      try {
        await chrome.action.setBadgeText({ text: text });
        if (text) await chrome.action.setBadgeBackgroundColor({ color: '#111111' });
        if (text && chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
      } catch (e) {}
    }

    function settingsOf(me) { return core.normalizeSettings(me && me.settings); }

    function nextMeeting(events, settings, t) {
      var list = (events || []).filter(function (e) {
        if (e.allDay || e.declined) return false;
        if (settings.meetingsOnly && !core.isMeeting(e)) return false;
        return core.toMs(e.end || e.start) > t;
      });
      list.sort(function (a, b) { return core.toMs(a.start) - core.toMs(b.start); });
      return list[0] || null;
    }

    function minutesTo(ev, t) {
      if (!ev) return null;
      var ms = core.toMs(ev.start) - t;
      if (ms <= 0) return null;
      var m = Math.ceil(ms / 60000);
      return m <= 60 ? m : null;
    }

    // Badge = minutes to the next meeting that has not started yet (<= 60), cleared otherwise.
    async function updateBadge(events, settings, t) {
      var up = (events || []).filter(function (e) {
        return !e.allDay && !e.declined && (!settings.meetingsOnly || core.isMeeting(e)) && core.toMs(e.start) > t;
      }).sort(function (x, y) { return core.toMs(x.start) - core.toMs(y.start); });
      var m = minutesTo(up[0], t);
      await setBadge(m == null ? '' : String(m));
    }

    async function refresh() {
      var out = await Promise.all([api('/api/upcoming'), api('/api/me')]);
      var up = out[0], me = out[1];
      await set({ events: up.events || [], eventsAt: now(), me: me });
      return { events: up.events || [], me: me };
    }

    async function firedSet() {
      var s = await get(['fired']);
      var f = s.fired || {};
      var t = now();
      var keep = {};
      Object.keys(f).forEach(function (k) { if (t - f[k] < 2 * 24 * 3600 * 1000) keep[k] = f[k]; });
      return keep;
    }

    // ---- showing the reminder ----

    function buildPayload(ev, settings, extra) {
      var p = { event: ev, settings: settings, mode: settings.style || 'flyby', isPrimary: true };
      if (extra) for (var k in extra) p[k] = extra[k];
      return p;
    }

    async function injectIntoTab(tabId, payload) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (p) { globalThis.__mpzPayload = p; },
        args: [payload]
      });
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['reminder.iife.js', 'launcher.js'] });
    }

    async function openPopupWindow(payload) {
      await set({ current: payload });
      var w = await chrome.windows.create({
        url: chrome.runtime.getURL('reminder.html'),
        type: 'popup', width: 520, height: 700, focused: true
      });
      await set({ popupWindowId: w && w.id });
      return w;
    }

    // Returns 'tab' | 'window'.
    async function showReminder(ev, settings) {
      var payload = buildPayload(ev, settings);
      await set({ current: payload });
      await notify(ev);
      var win = null;
      try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch (e) { win = null; }
      if (win && win.focused && win.id != null) {
        var tabs = await chrome.tabs.query({ active: true, windowId: win.id });
        var tab = tabs && tabs[0];
        if (tab && tab.id != null && scriptable(tab.url)) {
          try { await injectIntoTab(tab.id, payload); return 'tab'; } catch (e) { /* fall through to window */ }
        }
      }
      await openPopupWindow(payload);
      return 'window';
    }

    async function notify(ev) {
      try {
        var opts = {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Join the meeting.',
          message: (ev.title || 'Your meeting') + ' starts ' + core.inText(core.toMs(ev.start) - now()).replace(/^in /, 'in '),
          priority: 2,
          requireInteraction: true
        };
        if (ev.link) opts.buttons = [{ title: core.providerLabel(ev.link) }];
        await chrome.notifications.create(NOTIF_PREFIX + core.eventKey(ev), opts);
      } catch (e) {}
    }

    async function clearNotification(ev) {
      try { if (ev) await chrome.notifications.clear(NOTIF_PREFIX + core.eventKey(ev)); } catch (e) {}
    }

    // ---- main tick ----

    async function tick() {
      var s = await get(['token', 'events', 'me']);
      if (!s.token) { await setBadge(''); return { skipped: 'signed-out' }; }
      var events = s.events || [], me = s.me;
      try {
        var r = await refresh();
        events = r.events; me = r.me;
      } catch (e) {
        if (e.status === 401) return { skipped: 'unauthorized' };
        // offline / server error: keep going with the cache
      }
      var settings = settingsOf(me);
      var t = now();
      await updateBadge(events, settings, t);
      var fired = await firedSet();
      var due = core.pickDue(events, t, settings, new Set(Object.keys(fired)));
      var shown = [];
      if (due.length) {
        var ev = due[0];
        fired[core.eventKey(ev)] = t;
        await set({ fired: fired });
        var active = (await get(['active'])).active || {};
        active[core.eventKey(ev)] = ev;
        await set({ active: active });
        shown.push({ key: core.eventKey(ev), where: await showReminder(ev, settings) });
      } else {
        await set({ fired: fired });
      }
      return { shown: shown };
    }

    async function ensureAlarm() {
      var a = await chrome.alarms.get(TICK);
      if (!a) await chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });
    }

    // ---- reminder actions ----

    async function closePopupWindow() {
      var s = await get(['popupWindowId']);
      if (s.popupWindowId != null) {
        try { await chrome.windows.remove(s.popupWindowId); } catch (e) {}
        await chrome.storage.local.remove(['popupWindowId']);
      }
    }

    async function forget(ev) {
      var s = await get(['active']);
      var active = s.active || {};
      if (ev) delete active[core.eventKey(ev)];
      await set({ active: active });
      await clearNotification(ev);
    }

    async function onJoin(ev) {
      if (ev && ev.link) await chrome.tabs.create({ url: ev.link });
      await forget(ev);
      await chrome.alarms.clear(SNOOZE + (ev ? core.eventKey(ev) : ''));
      await closePopupWindow();
    }

    async function onSnooze(ev) {
      if (!ev) return;
      var s = await get(['me']);
      var secs = settingsOf(s.me).snoozeSeconds || 60;
      var active = (await get(['active'])).active || {};
      active[core.eventKey(ev)] = ev;
      await set({ active: active });
      await clearNotification(ev);
      await closePopupWindow();
      await chrome.alarms.create(SNOOZE + core.eventKey(ev), { delayInMinutes: Math.max(0.5, secs / 60) });
      // best effort: lets the server hold back its push for this event
      try { if (!ev.test) await api('/api/snooze', { method: 'POST', body: { key: core.eventKey(ev), seconds: secs } }); } catch (e) {}
    }

    async function onDismiss(ev) {
      await forget(ev);
      await closePopupWindow();
    }

    async function onSnoozeAlarm(key) {
      var s = await get(['active', 'me']);
      var ev = s.active && s.active[key];
      if (!ev) return { skipped: 'gone' };
      if (now() > core.toMs(ev.start) + STALE_MS && !ev.test) { await forget(ev); return { skipped: 'stale' }; }
      return { where: await showReminder(ev, settingsOf(s.me)) };
    }

    // ---- popup-facing operations ----

    async function signIn() {
      var base = await apiBase();
      var redirect = chrome.identity.getRedirectURL('cb');
      var url = base + '/api/auth/google/start?client=ext&return=' + encodeURIComponent(redirect);
      var finalUrl = await chrome.identity.launchWebAuthFlow({ url: url, interactive: true });
      var m = finalUrl && /[#?&]token=([^&#]+)/.exec(finalUrl);
      if (!m) throw new Error('No token returned');
      await set({ token: decodeURIComponent(m[1]) });
      var r = await refresh();
      await updateBadge(r.events, settingsOf(r.me), now());
      return { signedIn: true, me: r.me };
    }

    // Link another Google account to the signed-in user (Google account chooser in the auth window).
    async function addAccount() {
      var redirect = chrome.identity.getRedirectURL('cb');
      var l = await api('/api/accounts/link', { method: 'POST', body: { client: 'ext', 'return': redirect } });
      var finalUrl = await chrome.identity.launchWebAuthFlow({ url: l.url, interactive: true });
      var err = finalUrl && /[#?&]error=([^&#]+)/.exec(finalUrl);
      if (err) throw new Error(decodeURIComponent(err[1]));
      if (!finalUrl || !/[#?&]linked=1/.test(finalUrl)) throw new Error('not linked');
      var r = await refresh();
      await updateBadge(r.events, settingsOf(r.me), now());
      return { ok: true, me: r.me };
    }

    async function removeAccount(id) {
      await api('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
      var r = await refresh();
      await updateBadge(r.events, settingsOf(r.me), now());
      return { ok: true, me: r.me };
    }

    async function signOut() {
      try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
      await signOutLocal();
      return { signedIn: false };
    }

    async function getState(refreshNow) {
      var s = await get(['token', 'me', 'events', 'eventsAt']);
      if (!s.token) return { signedIn: false };
      var events = s.events || [], me = s.me;
      if (refreshNow || !s.eventsAt || now() - s.eventsAt > 45000) {
        try { var r = await refresh(); events = r.events; me = r.me; } catch (e) {
          if (e.status === 401) return { signedIn: false };
        }
      }
      var settings = settingsOf(me);
      var t = now();
      var next = nextMeeting(events, settings, t);
      return {
        signedIn: true, me: me, settings: settings, next: next,
        minutes: minutesTo(next, t), now: t,
        apiBase: await apiBase()
      };
    }

    async function saveSettings(patch) {
      var settings = await api('/api/settings', { method: 'PUT', body: patch });
      var s = await get(['me']);
      var me = Object.assign({}, s.me || {}, { settings: settings });
      await set({ me: me });
      return { settings: settingsOf(me) };
    }

    // Shows a fake reminder in the active tab after `delayMs`.
    async function testReminder(delayMs) {
      var s = await get(['me']);
      var settings = settingsOf(s.me);
      var t = now() + (delayMs == null ? 2000 : delayMs);
      var start = t + settings.leadSeconds * 1000 - 1000;
      var ev = {
        key: 'test-' + t, id: 'test', title: 'Quick sync', start: start, end: start + 30 * 60000,
        link: 'https://meet.google.com/', provider: 'meet', calendar: (s.me && s.me.email) || '',
        attendees: 'with Miles and 3 others', attendeeCount: 5, isMeeting: true, test: true
      };
      await new Promise(function (res) { wait(res, delayMs == null ? 2000 : delayMs); });
      var active = (await get(['active'])).active || {};
      active[ev.key] = ev;
      await set({ active: active });
      return { where: await showReminder(ev, settings) };
    }

    // ---- wiring ----

    function onMessage(msg, sender) {
      switch (msg && msg.type) {
        case 'join': return onJoin(msg.event);
        case 'snooze': return onSnooze(msg.event);
        case 'dismiss': return onDismiss(msg.event);
        case 'getState': return getState(!!msg.refresh);
        case 'signIn': return signIn();
        case 'signOut': return signOut();
        case 'addAccount': return addAccount();
        case 'removeAccount': return removeAccount(msg.id);
        case 'test': return testReminder(msg.delayMs);
        case 'saveSettings': return saveSettings(msg.patch || {});
        case 'getCurrent': return get(['current']).then(function (s) { return s.current || null; });
        default: return undefined;
      }
    }

    function onAlarm(alarm) {
      if (!alarm) return Promise.resolve();
      if (alarm.name === TICK) return tick();
      if (alarm.name.indexOf(SNOOZE) === 0) return onSnoozeAlarm(alarm.name.slice(SNOOZE.length));
      return Promise.resolve();
    }

    async function onNotifButton(id, idx) {
      if (id.indexOf(NOTIF_PREFIX) !== 0) return;
      var key = id.slice(NOTIF_PREFIX.length);
      var s = await get(['active']);
      var ev = s.active && s.active[key];
      if (ev) await onJoin(ev);
      try { await chrome.notifications.clear(id); } catch (e) {}
    }

    function register() {
      chrome.runtime.onInstalled.addListener(function () { ensureAlarm().then(tick).catch(function () {}); });
      chrome.runtime.onStartup.addListener(function () { ensureAlarm().then(tick).catch(function () {}); });
      chrome.alarms.onAlarm.addListener(function (a) { onAlarm(a).catch(function () {}); });
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        var p = onMessage(msg, sender);
        if (!p) return false;
        p.then(function (r) { sendResponse(r == null ? { ok: true } : r); },
          function (e) { sendResponse({ error: String((e && e.message) || e) }); });
        return true;
      });
      chrome.notifications.onButtonClicked.addListener(function (id, idx) { onNotifButton(id, idx).catch(function () {}); });
      chrome.notifications.onClicked.addListener(function (id) { onNotifButton(id, 0).catch(function () {}); });
      ensureAlarm().catch(function () {});
    }

    return {
      tick: tick, register: register, ensureAlarm: ensureAlarm, onMessage: onMessage, onAlarm: onAlarm,
      showReminder: showReminder, getState: getState, signIn: signIn, signOut: signOut, addAccount: addAccount, removeAccount: removeAccount, saveSettings: saveSettings,
      testReminder: testReminder, onNotifButton: onNotifButton, scriptable: scriptable
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { create: create };
  if (typeof importScripts === 'function') {
    importScripts('core.js');
    create({ chrome: root.chrome, core: root.MeetingPlzCore, fetch: root.fetch.bind(root) }).register();
  }
})(typeof self !== 'undefined' ? self : globalThis);
