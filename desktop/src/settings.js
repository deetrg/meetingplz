/* Settings window (design v2): departures board, rows + segmented controls, passport-stamp accounts. */
(function () {
  var MP = window.MP;
  var Core = window.MeetingPlzCore;
  var ART = window.MPZ_ART || {};
  var app = document.getElementById('app');
  var state = { signedIn: false, next: [], settings: Core.normalizeSettings({}) };
  var autostart = false;
  var signingIn = false;
  var linking = false;
  var acctErr = '';
  var api = '';
  var qaScroll = false; // QA only: MEETINGPLZ_FREEZE_MS set -> scroll to the bottom so CI screenshots show the lower half

  var LEADS = [[30, '30 sec'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
  var STYLES = [['flyby', 'Fly-by'], ['takeover', 'Takeover']];
  var ALARMS = [['jingle', 'Jingle'], ['buzz', 'Buzz'], ['bell', 'Bell'], ['beep', 'Beep'], ['off', 'Off']];
  var ONOFF = [[true, 'On'], [false, 'Off']];
  var WORDMARK = '<span class="wordmark" aria-label="MeetingPlz">Meeting<i>Plz</i><span class="wm-dot"></span></span>';
  var G_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
  function dayLabel(ms) {
    var d = new Date(ms), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Today';
    var tm = new Date(t.getTime() + 86400000);
    return d.toDateString() === tm.toDateString() ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' });
  }

  function seg(group, opts, cur, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button type="button" data-group="' + group + '" data-value="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function row(label, small, control, stack) {
    return '<li class="row' + (stack ? ' row--stack' : '') + '"><div class="row__k">' + label + (small ? '<small>' + small + '</small>' : '') + '</div>' + control + '</li>';
  }

  function statusChip(e) {
    var ms = Core.toMs(e.start) - Date.now(), lead = (state.settings.leadSeconds || 120) * 1000;
    if (ms <= 0) return '<span class="chip chip--final">Final call</span>';
    if (ms <= lead) return '<span class="chip chip--boarding">Boarding</span>';
    return '<span class="chip">On time</span>';
  }

  function boardBlock() {
    var all = state.next || [];
    if (!all.length) {
      return '<div class="empty">' + (ART.clouds || '') + '<p class="empty__t">Clear skies.</p><p class="empty__s">No meetings in the next 24 hours.</p></div>';
    }
    var list = all.slice(0, 3);
    var html = '<ol class="brd">' + list.map(function (e, i) {
      var st = Core.toMs(e.start);
      var meta = [Core.withText(e.attendees), e.link ? Core.gateLabel(e.link) : ''].filter(Boolean).join(' \u00B7 ');
      return '<li class="brd__row' + (i === 0 ? ' is-next' : '') + '"><span class="brd__t">' + esc(timeFmt.format(st)) + '<small>' + esc(dayLabel(st)) + '</small></span>' +
        '<span class="brd__n"><span>' + esc(e.title || 'Meeting') + '</span>' + (meta ? '<small>' + esc(meta) + '</small>' : '') + '</span>' + statusChip(e) + '</li>';
    }).join('') + '</ol>';
    if (all.length > 3) html += '<p class="brd__more">+' + (all.length - 3) + ' more</p>';
    return html;
  }

  function accountsBlock() {
    var list = (state.me && state.me.accounts) || [];
    var stamps = list.map(function (a) {
      var tag = a.error ? '<span class="stamp__tag is-warn">Sign in again</span>' : a.primary ? '<span class="stamp__tag">Main</span>' : '';
      var rm = list.length > 1 ? '<button class="stamp__x" type="button" aria-label="Remove ' + esc(a.email) + '" data-remove="' + esc(a.id) + '">\u00D7</button>' : '';
      return '<span class="stamp"><span class="stamp__em">' + esc(a.email) + '</span>' + tag + rm + '</span>';
    }).join('');
    if (!stamps) stamps = '<span class="stamp"><span class="stamp__em">' + esc((state.me && state.me.email) || '') + '</span></span>';
    return '<div class="stamps">' + stamps + '</div>' +
      '<div class="acct-act"><button class="btn btn--line btn--sm" id="addacct" type="button"' + (linking ? ' disabled' : '') + '>' + (linking ? 'Waiting for your browser\u2026' : 'Add another Google account') + '</button></div>' +
      (acctErr ? '<p class="err" role="alert">' + esc(acctErr) + '</p>' : '') +
      '<p class="note">Meetings from every account get a reminder.</p>';
  }

  function footer(signedIn) {
    return '<div class="foot"><span><button class="link-btn" type="button" data-open="/privacy">Privacy</button><i>\u00B7</i><button class="link-btn" type="button" data-open="/terms">Terms</button></span>' +
      (signedIn ? '<button class="link-btn" type="button" id="signout">Sign out</button>' : '') + '</div>';
  }

  function renderSignedOut() {
    app.innerHTML =
      '<div class="so rise">' +
      '<div class="so__art">' + (ART.plane || '') + '</div>' + WORDMARK +
      '<h1 class="so__h">Your meetings, <em>on time.</em></h1>' +
      '<p class="so__p">A reminder with one big Join button, before every meeting.</p>' +
      '<button class="gbtn" id="signin" type="button"' + (signingIn ? ' aria-busy="true"' : '') + '>' + G_SVG + '<span>' + (signingIn ? 'Waiting for your browser\u2026' : 'Continue with Google') + '</span></button>' +
      '<p class="so__note">On Google\u2019s screen, tick the calendar box so MeetingPlz can see your meetings.</p>' +
      '<div class="so__launch"><ul class="rows rows--compact">' + row('Launch at login', '', seg('autostart', ONOFF, autostart, 'Launch at login')) + '</ul></div>' +
      '</div>';
  }

  function renderApp() {
    var s = state.settings;
    app.innerHTML =
      '<div class="shell">' +
      '<header class="bar">' + WORDMARK + '</header>' +
      '<section class="sec"><div class="sec__head"><span class="lab">Departures \u00B7 next 24 hours</span><h1 class="sec__h">Next up</h1></div>' +
      '<div id="board">' + boardBlock() + '</div>' +
      '<div class="cta"><button class="btn btn--primary btn--compact btn--block" id="test" type="button"><span>Test it</span><span class="arr" aria-hidden="true">\u2192</span></button></div></section>' +
      '<section class="sec"><div class="sec__head"><h2 class="sec__h sec__h--s">Settings</h2></div><ul class="rows rows--compact">' +
      row('Remind me', '', seg('leadSeconds', LEADS, s.leadSeconds, 'Remind me'), true) +
      row('Style', '', seg('style', STYLES, s.style, 'Style')) +
      row('Alarm', '', seg('alarm', ALARMS, s.alarm, 'Alarm'), true) +
      row('Only real meetings', '', seg('meetingsOnly', ONOFF, s.meetingsOnly, 'Only real meetings')) +
      row('Launch at login', '', seg('autostart', ONOFF, autostart, 'Launch at login')) +
      '</ul></section>' +
      '<section class="sec"><div class="sec__head"><h2 class="sec__h sec__h--s">Accounts</h2></div><div id="accounts">' + accountsBlock() + '</div></section>' +
      footer(true) + '</div>';
    var so = document.getElementById('signout');
    if (so) so.onclick = function () { MP.logout().then(function () { return MP.invoke('sign_out'); }); };
  }

  function render() {
    if (state.signedIn) renderApp(); else renderSignedOut();
    var si = document.getElementById('signin');
    if (si) si.onclick = signIn;
    if (qaScroll && state.signedIn) setTimeout(function () { window.scrollTo(0, 100000); }, 400);
  }
  function renderParts() {
    var b = document.getElementById('board'); if (b) b.innerHTML = boardBlock();
    var a = document.getElementById('accounts'); if (a) a.innerHTML = accountsBlock();
  }

  function syncSeg() {
    document.querySelectorAll('.seg button[data-group]').forEach(function (b) {
      var g = b.dataset.group;
      var cur = g === 'autostart' ? autostart : state.settings[g];
      b.setAttribute('aria-pressed', String(String(cur) === b.dataset.value));
    });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.group && t.closest('.seg')) {
      var g = t.dataset.group, v = t.dataset.value;
      if (g === 'autostart') {
        MP.invoke('set_autostart', { enabled: v === 'true' }).then(function (r) { autostart = !!r; syncSeg(); });
        autostart = v === 'true'; syncSeg();
        return;
      }
      var val = g === 'leadSeconds' ? Number(v) : g === 'meetingsOnly' ? v === 'true' : v;
      var body = {}; body[g] = val;
      state.settings = Object.assign({}, state.settings, body);
      syncSeg();
      if (g === 'alarm' && val !== 'off' && window.MeetingPlzReminder && window.MeetingPlzReminder.playAlarm) { try { window.MeetingPlzReminder.playAlarm(val); } catch (e) {} }
      if (g === 'leadSeconds') renderParts();
      save(body);
      return;
    }
    if (t.dataset.remove) { removeAccount(t.dataset.remove); return; }
    if (t.dataset.open) { MP.invoke('open_url', { url: api + t.dataset.open }); return; }
    if (t.id === 'addacct') addAccount();
    else if (t.id === 'test') MP.emit('test-it');
  });

  async function save(partial) {
    try { await MP.putSettings(partial); } catch (e) {}
    MP.emit('refresh');
  }

  async function addAccount() {
    acctErr = ''; linking = true; renderParts();
    try { await MP.linkAccount(); } catch (e) { linking = false; acctErr = 'Could not start that. Try again.'; renderParts(); return; }
    // the system browser finishes the flow; the app is told through 'auth-changed' (-> refresh -> state-changed)
    setTimeout(function () { if (linking) { linking = false; renderParts(); } }, 120000);
  }

  async function removeAccount(id) {
    acctErr = '';
    try { await MP.removeAccount(id); } catch (e) { acctErr = 'Could not remove that account.'; renderParts(); return; }
    MP.emit('refresh');
  }

  async function signIn() {
    signingIn = true; render();
    try { await MP.invoke('sign_in'); } catch (e) { signingIn = false; render(); }
  }

  function apply(json) {
    try { var s = JSON.parse(json); } catch (e) { return; }
    if (!s) return;
    if (s.signedIn) signingIn = false;
    linking = false;
    state = s;
    state.settings = Core.normalizeSettings(s.settings);
    render();
  }

  async function init() {
    try { var c = await MP.cfg(); api = (c && c.api) || ''; qaScroll = !!c && typeof c.freezeMs === 'number'; } catch (e) {}
    // public pages live on the custom domain (pages.dev 301-redirects there)
    if (!api || /pages\.dev/.test(api)) api = 'https://meetingplz.nonolingo.com';
    autostart = await MP.invoke('get_autostart');
    MP.listen('state-changed', function (e) { apply(e.payload); });
    MP.listen('link-result', function (e) {
      var r = e.payload || {};
      linking = false;
      acctErr = r.ok ? '' : (r.status === 409 ? 'That Google account already belongs to another MeetingPlz account.' : 'Could not add that account. Try again.');
      renderParts();
    });
    var cur = await MP.invoke('get_state');
    if (cur) apply(cur); else render();
    MP.emit('refresh');
    setInterval(function () { if (state.signedIn) { var b = document.getElementById('board'); if (b) b.innerHTML = boardBlock(); } }, 10000);
  }
  window.addEventListener('DOMContentLoaded', init);
})();
