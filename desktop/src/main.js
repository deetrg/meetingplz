/* Hidden "brain" window: polls the API, decides what is due (shared/core.js), tells Rust to show overlays. */
(function () {
  var Core = window.MeetingPlzCore;
  var MP = window.MP;
  var POLL_MS = 60 * 1000;
  var FIRED_KEY = 'mp.fired';

  var cfg = {};
  var token = null;
  var me = null;
  var settings = Core.normalizeSettings({});
  var events = [];
  var serverOffset = 0; // server now - local now
  var lastPoll = 0;
  var polling = false;
  var fired = loadFired();
  var snoozes = {}; // key -> { until, event }
  var shown = null; // { key, event }

  function loadFired() {
    var m = {};
    try { m = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch (e) {}
    var cutoff = Date.now() - 36 * 3600 * 1000;
    Object.keys(m).forEach(function (k) { if (m[k] < cutoff) delete m[k]; });
    return m;
  }
  function saveFired() { try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) {} }
  function firedSet() { return { has: function (k) { return !!fired[k]; } }; }
  function nowMs() { return Date.now() + serverOffset; }

  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function upcomingMeetings() {
    var now = nowMs();
    return events.filter(function (e) {
      var st = Core.toMs(e.start);
      return !isNaN(st) && Core.toMs(e.end || e.start) > now && (!settings.meetingsOnly || Core.isMeeting(e));
    }).sort(function (a, b) { return Core.toMs(a.start) - Core.toMs(b.start); });
  }

  async function publish() {
    var list = upcomingMeetings();
    var state = { signedIn: !!token && !!me, me: me, settings: settings, next: list.slice(0, 8), now: nowMs(), demo: !!cfg.demo };
    var label;
    if (!state.signedIn) label = 'Next: sign in to start';
    else if (!list.length) label = 'No meetings coming up';
    else {
      var t = String(list[0].title || 'Meeting');
      if (t.length > 34) t = t.slice(0, 33) + '\u2026';
      label = 'Next: ' + t + ' \u00b7 ' + fmtTime(Core.toMs(list[0].start));
    }
    try { await MP.invoke('set_next', { text: label }); await MP.invoke('publish_state', { state: JSON.stringify(state) }); } catch (e) {}
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      token = await MP.invoke('get_token');
      if (!token) { me = null; events = []; return; }
      var r = await Promise.all([MP.me(), MP.upcoming()]);
      me = r[0];
      settings = Core.normalizeSettings(me && me.settings);
      var up = r[1] || {};
      events = Array.isArray(up.events) ? up.events : [];
      if (typeof up.now === 'number' || typeof up.now === 'string') {
        var sn = Core.toMs(up.now);
        if (!isNaN(sn)) serverOffset = sn - Date.now();
      }
      lastPoll = Date.now();
      MP.invoke('log_line', { line: 'poll ok: ' + (me && me.email) + ' events=' + events.length }).catch(function () {});
    } catch (e) {
      if (e && e.status === 401) { await MP.invoke('sign_out'); me = null; events = []; token = null; }
      MP.invoke('log_line', { line: 'poll failed: ' + (e && (e.status || e.message)) }).catch(function () {});
      // network errors: keep the last known events so reminders still fire
    } finally {
      polling = false;
      publish();
    }
  }

  function show(ev, opts) {
    var o = opts || {};
    shown = { key: ev.key, event: ev };
    return MP.invoke('show_overlay', { event: ev, settings: settings, mode: o.mode || settings.style });
  }

  function check() {
    var now = nowMs();
    if (shown) {
      var end = Core.toMs(shown.event.end);
      var limit = (isNaN(end) ? Core.toMs(shown.event.start) + 15 * 60000 : end);
      if (shown.test ? now > shown.test : now > limit) { MP.invoke('close_overlays'); shown = null; }
    }
    // snoozed events come back
    Object.keys(snoozes).forEach(function (k) {
      var s = snoozes[k];
      if (now >= s.until) { delete snoozes[k]; show(s.event); }
    });
    if (shown) return;
    if (cfg.demo || !token) return;
    var due = Core.pickDue(events, now, settings, firedSet());
    if (due.length) {
      var ev = due[0];
      var key = Core.eventKey(ev);
      fired[key] = Date.now();
      saveFired();
      show(ev.key ? ev : Object.assign({}, ev, { key: key }));
    }
  }

  function fakeEvent(offsetMs, extra) {
    var start = Date.now() + offsetMs;
    return Object.assign({
      key: 'test-' + start,
      id: 'test',
      title: 'Quick sync',
      start: start,
      end: start + 30 * 60000,
      link: 'https://meet.google.com/',
      provider: 'meet',
      calendar: (me && me.email) || 'you@example.com',
      attendees: 'with Miles and 3 others',
      attendeeCount: 5,
      isMeeting: true,
      allDay: false,
      declined: false
    }, extra || {});
  }

  function showTest(extra) {
    var ev = fakeEvent(118000, extra);
    shown = { key: ev.key, event: ev, test: Date.now() + 10 * 60000 };
    return MP.invoke('show_overlay', { event: ev, settings: settings, mode: settings.style }).then(function () { MP.invoke('log_line', { line: 'overlay shown' }); });
  }

  async function init() {
    cfg = await MP.cfg();
    MP.listen('tick', function () {
      check();
      if (!cfg.demo && Date.now() - lastPoll > POLL_MS + 5000) poll();
    });
    MP.listen('auth-changed', function () { poll(); });
    MP.listen('refresh', function () { poll(); });
    MP.listen('test-it', function () { showTest(); });
    MP.listen('reminder-action', function (e) {
      var p = e.payload || {};
      var wasTest = shown && shown.test;
      var s = shown;
      shown = null;
      if (p.action === 'snooze' && s && !wasTest) {
        snoozes[s.key] = { until: nowMs() + (settings.snoozeSeconds || 60) * 1000, event: s.event };
      }
    });
    if (cfg.demo) {
      publish();
      setTimeout(function () { showTest(); }, 3000);
      return;
    }
    await poll();
    setInterval(poll, POLL_MS);
    setInterval(check, 5000);
    check();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
