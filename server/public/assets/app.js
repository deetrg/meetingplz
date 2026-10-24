/* MeetingPlz web app. No framework. Uses shared/core.js (MeetingPlzCore) and shared/reminder (MeetingPlzReminder). */
(function () {
  'use strict';
  var Core = window.MeetingPlzCore;
  var Reminder = window.MeetingPlzReminder;
  var root = document.getElementById('root');

  var state = { me: null, events: [], settings: Core.DEFAULT_SETTINGS, push: 'checking', loadedAt: 0, serverSkew: 0 };
  var fired = loadFired();
  var snoozed = {}; // key -> { until, evt }
  var live = null; // current in-page reminder { key, handle }

  var G_SVG = '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.500c3.500 0 6.600 1.200 9.100 3.600l6.800-6.800C35.800 2.400 30.300 0 24 0 14.600 0 6.500 5.400 2.600 13.200l7.900 6.100C12.400 13.600 17.700 9.500 24 9.500z"/><path fill="#4285F4" d="M46.500 24.500c0-1.600-.1-3.100-.4-4.500H24v9h12.700c-.6 3-2.300 5.500-4.800 7.200l7.500 5.800c4.400-4.100 7.100-10.100 7.100-17.500z"/><path fill="#FBBC05" d="M10.500 28.700c-.5-1.400-.8-3-.8-4.700s.3-3.200.8-4.700l-7.900-6.100C.9 16.400 0 20.100 0 24s.9 7.600 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.500-5.800c-2.100 1.400-4.800 2.300-8.400 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>';
  var GOOGLE_BTN = '<a class="btn primary" id="signin" href="/api/auth/google/start?client=web"><span class="gmark">' + G_SVG + '</span>Continue with Google</a>';

  var LEADS = [[30, '30 sec'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
  var STYLES = [['flyby', 'Fly-by'], ['takeover', 'Takeover']];
  var ALARMS = [['jingle', 'Jingle'], ['buzz', 'Buzz'], ['bell', 'Bell'], ['beep', 'Beep'], ['off', 'Off']];
  var ERRORS = {
    calendar_access_needed: 'MeetingPlz needs to see your calendar to remind you. Please try again and tick the calendar box.',
    access_denied: 'Sign-in was cancelled.',
    google_exchange_failed: 'Google sign-in did not finish. Please try again.'
  };

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function now() { return Date.now() + state.serverSkew; }
  function loadFired() { try { return new Set(JSON.parse(localStorage.getItem('mp_fired') || '[]')); } catch (e) { return new Set(); } }
  function saveFired() { try { localStorage.setItem('mp_fired', JSON.stringify(Array.from(fired).slice(-60))); } catch (e) {} }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'content-type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, data: j }; });
    });
  }
  var timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
  function dayLabel(ms) {
    var d = new Date(ms), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Today';
    var tm = new Date(t.getTime() + 86400000);
    return d.toDateString() === tm.toDateString() ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' });
  }

  /* ---------- platform ---------- */
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

  function swReg() {
    return navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).then(function () { return navigator.serviceWorker.ready; });
  }
  function b64uToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function refreshPushState() {
    if (isIOS && !standalone) { state.push = 'needs-install'; return Promise.resolve(); }
    if (!pushSupported()) { state.push = 'unsupported'; return Promise.resolve(); }
    if (Notification.permission === 'denied') { state.push = 'denied'; return Promise.resolve(); }
    if (Notification.permission !== 'granted') { state.push = 'off'; return Promise.resolve(); }
    return swReg().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      state.push = sub ? 'on' : 'off';
      if (sub) api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }); // keep server in sync
    }).catch(function () { state.push = 'off'; });
  }

  function enablePush() {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { state.push = perm === 'denied' ? 'denied' : 'off'; return; }
      return swReg().then(function (reg) {
        return api('/api/push/vapid').then(function (v) {
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(v.data.publicKey) });
          });
        });
      }).then(function (sub) {
        return api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }).then(function (r) {
          state.push = r.ok ? 'on' : 'off';
          if (!r.ok) toast('Could not turn on notifications.');
        });
      });
    }).catch(function () { toast('Could not turn on notifications.'); });
  }

  function disablePush() {
    return swReg().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return api('/api/push/subscribe', { method: 'DELETE', body: { endpoint: ep } }); });
    }).then(function () { state.push = 'off'; });
  }

  /* ---------- data ---------- */
  function loadUpcoming() {
    return api('/api/upcoming').then(function (r) {
      if (r.status === 401) { if (r.data && r.data.error === 'reauth') toast('Please sign in again to keep reminders working.'); state.me = null; return false; }
      if (r.ok) {
        state.events = r.data.events || [];
        state.serverSkew = (r.data.now || Date.now()) - Date.now();
        state.loadedAt = Date.now();
      }
      return true;
    });
  }

  function visibleEvents() {
    var t = now();
    return state.events.filter(function (e) {
      if (e.end && e.end < t) return false;
      return !state.settings.meetingsOnly || Core.isMeeting(e);
    });
  }

  /* ---------- in-page reminder ---------- */
  function showReminder(evt, isTest) {
    if (live) { try { live.handle.close(); } catch (e) {} live = null; }
    var key = evt.key;
    var handle = Reminder.show({
      event: evt,
      settings: state.settings,
      mode: state.settings.style,
      now: now,
      onJoin: function () { if (evt.link && !isTest) window.open(evt.link, '_blank', 'noopener'); done(); },
      onSnooze: function () {
        if (!isTest) snoozed[key] = { until: now() + state.settings.snoozeSeconds * 1000, evt: evt };
        done();
      },
      onDismiss: function () { done(); }
    });
    live = { key: key, handle: handle };
    function done() { try { handle.close(); } catch (e) {} if (live && live.handle === handle) live = null; }
  }

  function tick() {
    if (!state.me) return;
    var t = now();
    if (!live) {
      Object.keys(snoozed).forEach(function (k) {
        if (!live && snoozed[k].until <= t) { var s = snoozed[k]; delete snoozed[k]; showReminder(s.evt); }
      });
    }
    if (live) return;
    var due = Core.pickDue(state.events, t, state.settings, fired);
    if (due.length) {
      var evt = due[0];
      fired.add(Core.eventKey(evt));
      saveFired();
      showReminder(evt);
    }
  }

  function testIt() {
    var start = now() + 120000;
    showReminder({
      key: 'test:' + start, title: 'Quick sync', start: start, end: start + 1800000,
      link: 'https://meet.google.com/abc-defg-hij', calendar: (state.me && state.me.email) || '', attendees: 'with Miles and 3 others'
    }, true);
  }

  /* ---------- render ---------- */
  function renderSignedOut(error) {
    root.innerHTML =
      '<div class="splash">' +
      '<img class="art drift" src="/shared/art/plane.svg" alt="" width="300" height="125">' +
      '<h1>MeetingPlz.</h1>' +
      (error ? '<div class="err" role="alert">' + esc(ERRORS[error] || 'Something went wrong. Please try again.') + '</div>' : '') +
      GOOGLE_BTN +
      '<div class="small muted"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>' +
      '</div>';
  }

  function pills(group, opts, cur) {
    return '<div class="pills" data-group="' + group + '">' + opts.map(function (o) {
      return '<button type="button" class="pill" data-group="' + group + '" data-value="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function notifBlock() {
    var p = state.push;
    if (p === 'needs-install') {
      return '<p><b>Add to Home Screen first.</b></p><p class="note">1. Tap the Share button in Safari.<br>2. Tap Add to Home Screen, then open MeetingPlz from your Home Screen and turn on notifications.</p>';
    }
    if (p === 'unsupported') return '<p class="note">This browser cannot show notifications. Keep this tab open, or get the app below.</p>';
    if (p === 'denied') return '<p class="note">Notifications are blocked for this site. Allow them in your browser settings, then reload.</p>';
    if (p === 'on') {
      return '<div class="row"><b>Notifications are on</b><div class="pills"><button class="btn sm" id="push-test" type="button">Send a test</button><button class="btn text sm" id="push-off" type="button">Turn off</button></div></div>';
    }
    if (p === 'checking') return '<p class="note">Checking…</p>';
    return '<button class="btn block" id="push-on" type="button">Turn on notifications</button><p class="note">Get the reminder even when this tab is closed.</p>';
  }

  function meetingRows() {
    var list = visibleEvents();
    if (!list.length) {
      return '<div class="card empty"><img class="art" src="/shared/art/person-laptop.svg" alt="" width="180" height="150"><p><b>Nothing in the next 24 hours.</b></p><p class="note">Enjoy the quiet.</p></div>';
    }
    return '<div class="list">' + list.map(function (e) {
      var join = e.link ? '<a class="btn sm" href="' + esc(e.link) + '" target="_blank" rel="noopener">Join</a>' : '';
      return '<div class="mtg"><div class="t">' + esc(timeFmt.format(e.start)) + '<small>' + esc(dayLabel(e.start)) + '</small></div>' +
        '<div class="b"><b>' + esc(e.title) + '</b><span>' + esc(e.attendees || e.calendar) + '</span></div>' + join + '</div>';
    }).join('') + '</div>';
  }

  function renderApp() {
    var me = state.me, s = state.settings;
    var initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    var avatar = me.picture ? '<img class="avatar" src="' + esc(me.picture) + '" alt="" referrerpolicy="no-referrer">' : '<span class="avatar">' + esc(initial) + '</span>';
    var dl = (document.getElementById('dl-src') || {}).innerHTML || '';
    root.innerHTML =
      '<div class="bar"><a class="wordmark" href="/app">MeetingPlz.</a><div class="who">' + avatar + '<span>' + esc(me.email) + '</span><button class="btn text sm" id="logout" type="button">Sign out</button></div></div>' +
      '<section><button class="btn primary block" id="test-it" type="button" style="min-height:64px;font-size:18px">Test it</button></section>' +
      '<section><h2>Next up</h2><div id="meetings">' + meetingRows() + '</div></section>' +
      '<section><h2>Notifications</h2><div class="card" id="notif">' + notifBlock() + '</div></section>' +
      '<section><h2>Settings</h2><div class="card stack">' +
      '<div class="field"><label>Remind me</label>' + pills('leadSeconds', LEADS, s.leadSeconds) + '</div>' +
      '<div class="field"><label>Style</label>' + pills('style', STYLES, s.style) + '</div>' +
      '<div class="field"><label>Alarm</label>' + pills('alarm', ALARMS, s.alarm) + '</div>' +
      '<div class="field"><label>Only real meetings</label>' + pills('meetingsOnly', [[true, 'On'], [false, 'Off']], s.meetingsOnly) + '<p class="note">Skips all-day events and solo blocks.</p></div>' +
      '</div></section>' +
      '<section><h2>Get MeetingPlz for…</h2>' + dl + '</section>' +
      '<div class="danger"><button class="btn text sm" id="delete-account" type="button">Delete account</button></div>' +
      '<footer class="foot" style="padding:12px 0 0"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>';
  }

  function rerenderParts() {
    var m = document.getElementById('meetings'); if (m) m.innerHTML = meetingRows();
    var n = document.getElementById('notif'); if (n) n.innerHTML = notifBlock();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, a');
    if (!t) return;
    if (t.classList.contains('pill') && t.dataset.group) {
      var g = t.dataset.group, v = t.dataset.value;
      var val = g === 'leadSeconds' ? Number(v) : g === 'meetingsOnly' ? v === 'true' : v;
      var body = {}; body[g] = val;
      state.settings = Object.assign({}, state.settings, body);
      renderApp();
      api('/api/settings', { method: 'PUT', body: body }).then(function (r) {
        if (r.ok) { state.settings = r.data; rerenderSettings(); } else toast('Could not save that.');
      });
      return;
    }
    switch (t.id) {
      case 'test-it': testIt(); break;
      case 'push-on': enablePush().then(rerenderParts); break;
      case 'push-off': disablePush().then(rerenderParts); break;
      case 'push-test':
        api('/api/test-reminder', { method: 'POST' }).then(function (r) { toast(r.ok ? 'Sending. It should arrive in a few seconds.' : 'No notification device found. Turn notifications on again.'); });
        break;
      case 'logout':
        api('/api/logout', { method: 'POST' }).then(function () { state.me = null; renderSignedOut(); });
        break;
      case 'delete-account': openDelete(); break;
    }
  });

  function rerenderSettings() { if (state.me) renderApp(); }

  function openDelete() {
    var d = document.createElement('dialog');
    d.innerHTML = '<h2>Delete your account?</h2><p class="muted">This deletes everything MeetingPlz stores about you and disconnects your Google account. It cannot be undone.</p>' +
      '<div class="acts"><button class="btn sm" id="del-cancel" type="button">Cancel</button><button class="btn primary sm" id="del-go" type="button">Delete everything</button></div>';
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('#del-cancel').onclick = function () { d.close(); d.remove(); };
    d.querySelector('#del-go').onclick = function () {
      d.querySelector('#del-go').disabled = true;
      var unsub = (state.push === 'on') ? disablePush().catch(function () {}) : Promise.resolve();
      unsub.then(function () { return api('/api/me', { method: 'DELETE' }); }).then(function (r) {
        d.close(); d.remove();
        if (r.ok) { try { localStorage.clear(); } catch (e) {} state.me = null; state.events = []; renderSignedOut(); toast('Your account was deleted.'); }
        else toast('Could not delete. Please try again.');
      });
    };
  }

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function () { loadUpcoming().then(tick); });
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.me && Date.now() - state.loadedAt > 30000) loadUpcoming().then(function () { rerenderParts(); tick(); });
  });

  /* ---------- boot ---------- */
  var params = new URLSearchParams(location.search);
  var bootError = params.get('error');
  if (bootError) history.replaceState(null, '', '/app');

  root.innerHTML = '<div class="spin">…</div>';
  api('/api/me').then(function (r) {
    if (!r.ok) { renderSignedOut(bootError); return; }
    state.me = r.data;
    state.settings = Core.normalizeSettings(r.data.settings);
    return Promise.all([loadUpcoming(), refreshPushState()]).then(function () {
      if (!state.me) { renderSignedOut(); return; }
      renderApp();
      setInterval(tick, 1000);
      setInterval(function () { if (!document.hidden) loadUpcoming().then(rerenderParts); }, 45000);
    });
  }).catch(function () { renderSignedOut(); });
})();
