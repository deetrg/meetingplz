/* MeetingPlz web app. No framework. Uses shared/core.js (MeetingPlzCore) and shared/reminder (MeetingPlzReminder).
 * Design v2: departures board, passport-stamp accounts, rows + segmented settings, demo mode (sample meetings, local-only settings). */
(function () {
  'use strict';
  var Core = window.MeetingPlzCore;
  var Reminder = window.MeetingPlzReminder;
  var root = document.getElementById('root');

  var state = { me: null, demo: false, events: [], settings: Core.DEFAULT_SETTINGS, push: 'checking', loadedAt: 0, serverSkew: 0 };
  var fired = loadFired();
  var snoozed = {}; // key -> { until, evt }
  var live = null; // current in-page reminder { key, handle }
  var timersOn = false;

  var G_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  var GOOGLE_BTN = '<a class="gbtn" id="signin" href="/api/auth/google/start?client=web">' + G_SVG + '<span>Continue with Google</span></a>';

  var LEADS = [[30, '30 sec'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
  var STYLES = [['flyby', 'Fly-by'], ['takeover', 'Takeover']];
  var ALARMS = [['jingle', 'Jingle'], ['buzz', 'Buzz'], ['bell', 'Bell'], ['beep', 'Beep'], ['off', 'Off']];
  var ERRORS = {
    calendar_access_needed: 'MeetingPlz needs to see your calendar to remind you. Please try again and tick the calendar box.',
    access_denied: 'Sign-in was cancelled.',
    google_exchange_failed: 'Google sign-in did not finish. Please try again.',
    account_in_use: 'That Google account already belongs to another MeetingPlz account that has other accounts linked.',
    link_failed: 'Could not add that account. Please try again.',
    no_refresh_token: 'Google did not give MeetingPlz long-term access. Please try again and accept everything.'
  };

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function now() { return Date.now() + state.serverSkew; }
  function loadFired() { try { return new Set(JSON.parse(localStorage.getItem('mp_fired') || '[]')); } catch (e) { return new Set(); } }
  function saveFired() { try { localStorage.setItem('mp_fired', JSON.stringify(Array.from(fired).slice(-60))); } catch (e) {} }
  function art(name) { var n = document.querySelector('#art-src [data-art="' + name + '"]'); return n ? n.innerHTML : ''; }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
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
  var WORDMARK = '<a class="wordmark" href="/app" aria-label="MeetingPlz">Meeting<i>Plz</i><span class="wm-dot"></span></a>';

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

  /* ---------- demo mode: sample meetings, settings stay on this device ---------- */
  var DEMO_KEY = 'mp_demo';
  var DEMO_SETTINGS_KEY = 'mp_demo_settings';
  function demoEvents() {
    var t = Date.now(), m = 60000;
    function ev(min, title, att, count, link) {
      var s = t + min * m;
      return { key: 'demo:' + title, title: title, start: s, end: s + 30 * m, link: link, attendees: att, attendeeCount: count, calendar: 'you@example.com' };
    }
    return [
      ev(1.6, 'Quick sync with design', 'with Miles and 3 others', 5, 'https://meet.google.com/abc-defg-hij'),
      ev(62, 'Pipeline review', 'with Anh', 2, 'https://zoom.us/j/123456789'),
      ev(190, 'Customer call: Northwind', 'with Priya and 1 other', 3, 'https://teams.microsoft.com/l/meetup-join/demo'),
      ev(400, 'Weekly planning', 'with Lena and 5 others', 7, '')
    ];
  }
  function enterDemo() {
    try { localStorage.setItem(DEMO_KEY, '1'); } catch (e) {}
    var s = {};
    try { s = JSON.parse(localStorage.getItem(DEMO_SETTINGS_KEY) || '{}'); } catch (e) {}
    state.demo = true;
    state.me = { email: 'you@example.com', name: 'Demo', accounts: [{ id: 'demo', email: 'you@example.com', primary: true }], settings: s };
    state.settings = Core.normalizeSettings(s);
    state.events = demoEvents();
    state.push = 'off';
    renderApp();
    startTimers();
  }
  function exitDemo() {
    try { localStorage.removeItem(DEMO_KEY); } catch (e) {}
    state.demo = false; state.me = null; state.events = [];
    if (live) { try { live.handle.close(); } catch (e) {} live = null; }
    renderSignedOut();
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
      upcoming: visibleEvents(),
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
    if (!state.me || state.demo) return;
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
  // Google returned without the calendar box ticked: explain, and restart consent for that one scope only.
  function renderConsentStep() {
    root.innerHTML =
      '<div class="so rise">' +
      '<div class="so__cal">' + art('calendar-check') + '</div>' +
      '<h1 class="so__h">One more <em>step.</em></h1>' +
      '<p class="so__p">Tick <b>\u201CSee your calendars\u201D</b> on Google\'s screen so MeetingPlz can remind you before each meeting.</p>' +
      '<a class="gbtn" id="consent-retry" href="/api/auth/google/start?client=web&amp;scope=calendar">' + G_SVG + '<span>Continue</span></a>' +
      '<p class="so__legal"><a href="/privacy">Privacy</a><i>\u00B7</i><a href="/terms">Terms</a></p>' +
      '</div>';
  }

  function renderSignedOut(error) {
    if (error === 'calendar_access_needed') { renderConsentStep(); return; }
    root.innerHTML =
      '<div class="so rise">' +
      '<div class="so__art">' + art('plane') + '</div>' +
      WORDMARK +
      '<h1 class="so__h">Your meetings, <em>on time.</em></h1>' +
      (error ? '<div class="err" role="alert">' + esc(ERRORS[error] || 'Something went wrong. Please try again.') + '</div>' : '') +
      GOOGLE_BTN +
      '<button class="link-btn is-muted" id="try-demo" type="button">Try it without signing in</button>' +
      '<p class="so__note">On Google\'s screen, tick the calendar box so MeetingPlz can see your meetings.</p>' +
      '<p class="so__legal"><a href="/privacy">Privacy</a><i>\u00B7</i><a href="/terms">Terms</a></p>' +
      '</div>';
  }

  function seg(group, opts, cur, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '" data-group="' + group + '">' + opts.map(function (o) {
      return '<button type="button" data-group="' + group + '" data-value="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function notifBlock() {
    var p = state.push;
    function row(k, v) { return '<li class="row"><div class="row__k">Notifications' + (k ? '<small>' + k + '</small>' : '') + '</div>' + (v || '') + '</li>'; }
    if (state.demo) return row('Sign in to get reminders when this tab is closed.', '<span class="row__v">Off</span>');
    if (p === 'needs-install') return row('Tap Share in Safari, then Add to Home Screen. Open MeetingPlz from your Home Screen and turn on notifications.', '<span class="row__v">Needs install</span>');
    if (p === 'unsupported') return row('This browser cannot show notifications. Keep this tab open, or get the app below.', '<span class="row__v">Unavailable</span>');
    if (p === 'denied') return row('Blocked for this site. Allow them in your browser settings, then reload.', '<span class="row__v">Blocked</span>');
    if (p === 'on') return row('', '<div class="row__act"><span class="row__v">On</span><button class="link-btn" id="push-test" type="button">Send a test</button><button class="link-btn is-muted" id="push-off" type="button">Turn off</button></div>');
    if (p === 'checking') return row('', '<span class="row__v">Checking\u2026</span>');
    return row('Get the reminder even when this tab is closed.', '<button class="btn btn--line btn--sm" id="push-on" type="button">Turn on</button>');
  }

  function statusChip(e) {
    var ms = e.start - now(), lead = (state.settings.leadSeconds || 120) * 1000;
    if (ms <= 0) return '<span class="chip chip--final">Final call</span>';
    if (ms <= lead) return '<span class="chip chip--boarding">Boarding</span>';
    return '<span class="chip">On time</span>';
  }

  function meetingRows() {
    var list = visibleEvents();
    if (!list.length) {
      return '<div class="empty">' + art('clouds') + '<p class="empty__t">Clear skies.</p><p class="empty__s">No meetings in the next 24 hours.</p></div>';
    }
    return '<ol class="brd">' + list.map(function (e, i) {
      var gate = e.link ? '<a href="' + esc(e.link) + '" target="_blank" rel="noopener">' + esc(Core.gateLabel(e.link)) + ' \u2197</a>' : '\u2014';
      var meta = [Core.withText(e.attendees), e.calendar].filter(Boolean).join(' \u00B7 ');
      return '<li class="brd__row' + (i === 0 ? ' is-next' : '') + '"><span class="brd__t">' + esc(timeFmt.format(e.start)) + '<small>' + esc(dayLabel(e.start)) + '</small></span>' +
        '<span class="brd__n"><span>' + esc(e.title) + '</span>' + (meta ? '<small>' + esc(meta) + '</small>' : '') + '</span>' +
        '<span class="brd__g">' + gate + '</span>' + statusChip(e) + '</li>';
    }).join('') + '</ol>';
  }

  function accountRows() {
    var list = (state.me && state.me.accounts) || [];
    var stamps = list.map(function (a) {
      var tag = a.error ? '<span class="stamp__tag is-warn">Sign in again</span>' : state.demo ? '<span class="stamp__tag">Sample</span>' : a.primary ? '<span class="stamp__tag">Main</span>' : '';
      var rm = list.length > 1 && !state.demo ? '<button class="stamp__x" type="button" aria-label="Remove ' + esc(a.email) + '" data-remove="' + esc(a.id) + '" data-email="' + esc(a.email) + '">\u00D7</button>' : '';
      return '<span class="stamp"><span class="stamp__em">' + esc(a.email) + '</span>' + tag + rm + '</span>';
    }).join('');
    if (state.demo) {
      return '<div class="stamps">' + stamps + '</div><p class="note">Sign in to connect your Google accounts. Meetings from every account get a reminder.</p>';
    }
    return '<div class="stamps">' + stamps + '</div><div class="acct-act"><button class="btn btn--line btn--sm" id="add-account" type="button">Add another Google account</button></div>' +
      '<p class="note">Meetings from every account get a reminder.</p>';
  }

  function renderApp() {
    var me = state.me, s = state.settings;
    var initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    var avatar = me.picture ? '<img class="avatar" src="' + esc(me.picture) + '" alt="" referrerpolicy="no-referrer">' : '<span class="avatar">' + esc(initial) + '</span>';
    var dl = ((document.getElementById('dl-src') || {}).innerHTML || '').replace('class="tickets"', 'class="tickets tickets--sm"');
    var who = state.demo
      ? '<button class="btn--text link-btn is-muted" id="exit-demo" type="button">Exit demo</button>'
      : '<div class="who"><button class="avatar-btn" id="menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' + avatar + '</button>' +
        '<div class="menu" id="menu" role="menu" hidden><div class="menu__em">' + esc(me.email) + '</div><button id="logout" type="button" role="menuitem">Sign out</button></div></div>';
    root.innerHTML =
      (state.demo ? '<div class="demo" role="note"><span>Demo mode<span class="hide-sm"> \u00B7 sample meetings, settings stay on this device</span></span><a href="/api/auth/google/start?client=web" id="demo-signin">Sign in</a></div>' : '') +
      '<div class="shell">' +
      '<header class="bar">' + WORDMARK + who + '</header>' +
      '<section class="sec"><div class="sec__head"><div><span class="lab">Departures \u00B7 next 24 hours</span><h1 class="sec__h">Next up</h1></div></div>' +
      '<div id="meetings">' + meetingRows() + '</div>' +
      '<div class="sec__cta"><button class="btn btn--primary" id="test-it" type="button"><span>Test it</span><span class="arr" aria-hidden="true">\u2192</span></button><p>See the reminder exactly as it will appear.</p></div></section>' +
      '<section class="sec"><div class="sec__head"><h2 class="sec__h sec__h--s">Settings</h2></div><ul class="rows" id="settings">' +
      '<li class="row row--seg"><div class="row__k">Remind me<small>Before each meeting starts</small></div>' + seg('leadSeconds', LEADS, s.leadSeconds, 'Remind me') + '</li>' +
      '<li class="row row--seg"><div class="row__k">Style<small>How the reminder arrives</small></div>' + seg('style', STYLES, s.style, 'Style') + '</li>' +
      '<li class="row row--seg"><div class="row__k">Alarm<small>Plays with the reminder</small></div>' + seg('alarm', ALARMS, s.alarm, 'Alarm') + '</li>' +
      '<li class="row row--seg"><div class="row__k">Only real meetings<small>Skips all-day events and solo blocks</small></div>' + seg('meetingsOnly', [[true, 'On'], [false, 'Off']], s.meetingsOnly, 'Only real meetings') + '</li>' +
      '</ul></section>' +
      '<section class="sec"><div class="sec__head"><h2 class="sec__h sec__h--s">Accounts</h2></div><div id="accounts">' + accountRows() + '</div></section>' +
      '<section class="sec"><ul class="rows" id="notif">' + notifBlock() + '</ul></section>' +
      '<section class="sec plat"><div class="sec__head"><h2 class="sec__h sec__h--s">Get MeetingPlz for\u2026</h2></div>' + dl + '</section>' +
      '<div class="danger"><span><a href="/privacy">Privacy</a><i>\u00B7</i><a href="/terms">Terms</a></span>' +
      (state.demo ? '' : '<button class="link-btn is-muted" id="delete-account" type="button">Delete account</button>') + '</div>' +
      '</div>';
  }

  function rerenderParts() {
    var m = document.getElementById('meetings'); if (m) m.innerHTML = meetingRows();
    var n = document.getElementById('notif'); if (n) n.innerHTML = notifBlock();
    var a = document.getElementById('accounts'); if (a) a.innerHTML = accountRows();
  }

  function syncSeg() {
    document.querySelectorAll('.seg button[data-group]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(String(state.settings[b.dataset.group]) === b.dataset.value));
    });
  }

  function addAccount() {
    var b = document.getElementById('add-account'); if (b) b.disabled = true;
    api('/api/accounts/link', { method: 'POST', body: { client: 'web' } }).then(function (r) {
      if (r.ok && r.data.url) { location.href = r.data.url; return; }
      if (b) b.disabled = false;
      toast('Could not start that. Please try again.');
    });
  }

  function removeAccount(id, email) {
    if (!window.confirm('Remove ' + email + '? Its meetings will no longer get reminders.')) return;
    api('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
      if (!r.ok) { toast(r.data && r.data.error === 'last_account' ? 'You need at least one account.' : 'Could not remove that account.'); return; }
      return api('/api/me').then(function (m) {
        if (m.ok) state.me = m.data;
        return loadUpcoming();
      }).then(function () { rerenderParts(); });
    });
  }

  function setMenu(open) {
    var m = document.getElementById('menu'), b = document.getElementById('menu-btn');
    if (!m || !b) return;
    m.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var menu = document.getElementById('menu');
    if (menu && !menu.hidden && !ev.target.closest('.who')) setMenu(false);
    var t = ev.target.closest('button, a');
    if (!t) return;
    if (t.dataset && t.dataset.group && t.closest('.seg')) {
      var g = t.dataset.group, v = t.dataset.value;
      var val = g === 'leadSeconds' ? Number(v) : g === 'meetingsOnly' ? v === 'true' : v;
      var body = {}; body[g] = val;
      state.settings = Object.assign({}, state.settings, body);
      syncSeg();
      if (g === 'alarm' && val !== 'off' && Reminder.playAlarm) { try { Reminder.playAlarm(val); } catch (e) {} }
      if (g === 'meetingsOnly' || g === 'leadSeconds') rerenderParts();
      if (state.demo) {
        try { var cur = JSON.parse(localStorage.getItem(DEMO_SETTINGS_KEY) || '{}'); localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(Object.assign(cur, body))); } catch (e) {}
        return;
      }
      api('/api/settings', { method: 'PUT', body: body }).then(function (r) {
        if (r.ok) { state.settings = r.data; syncSeg(); rerenderParts(); } else toast('Could not save that.');
      });
      return;
    }
    if (t.dataset && t.dataset.remove) { removeAccount(t.dataset.remove, t.dataset.email); return; }
    switch (t.id) {
      case 'menu-btn': setMenu(document.getElementById('menu').hidden); break;
      case 'add-account': addAccount(); break;
      case 'test-it': testIt(); break;
      case 'try-demo': enterDemo(); break;
      case 'exit-demo': exitDemo(); break;
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  function openDelete() {
    var d = document.createElement('dialog');
    d.innerHTML = '<h2>Delete your account?</h2><p>This deletes everything MeetingPlz stores about you and disconnects your Google account. It cannot be undone.</p>' +
      '<div class="acts"><button class="link-btn" id="del-cancel" type="button">Cancel</button><button class="btn btn--primary btn--sm" id="del-go" type="button">Delete everything</button></div>';
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
    if (!document.hidden && state.me && !state.demo && Date.now() - state.loadedAt > 30000) loadUpcoming().then(function () { rerenderParts(); tick(); });
  });

  function startTimers() {
    if (timersOn) return;
    timersOn = true;
    setInterval(tick, 1000);
    setInterval(function () { if (!document.hidden && state.me && !state.demo) loadUpcoming().then(rerenderParts); }, 45000);
    setInterval(function () { if (!document.hidden && state.me) { var m = document.getElementById('meetings'); if (m) m.innerHTML = meetingRows(); } }, 10000); // keep status chips current
  }

  /* ---------- boot ---------- */
  var params = new URLSearchParams(location.search);
  var bootError = params.get('error');
  var justLinked = params.get('linked') === '1';
  if (bootError || justLinked) history.replaceState(null, '', '/app');

  root.innerHTML = '<div class="spin">\u2026</div>';
  api('/api/me').then(function (r) {
    if (!r.ok) {
      var wantDemo = false;
      try { wantDemo = localStorage.getItem(DEMO_KEY) === '1' && !bootError; } catch (e) {}
      if (wantDemo || params.get('demo') === '1') { enterDemo(); return; }
      renderSignedOut(bootError); return;
    }
    try { localStorage.removeItem(DEMO_KEY); } catch (e) {}
    if (bootError) toast(ERRORS[bootError] || 'Something went wrong. Please try again.');
    if (justLinked) toast('Account added.');
    state.me = r.data;
    state.settings = Core.normalizeSettings(r.data.settings);
    return Promise.all([loadUpcoming(), refreshPushState()]).then(function () {
      if (!state.me) { renderSignedOut(); return; }
      renderApp();
      startTimers();
    });
  }).catch(function () { renderSignedOut(); });
})();
