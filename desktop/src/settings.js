(function () {
  var MP = window.MP;
  var Core = window.MeetingPlzCore;
  var app = document.getElementById('app');
  var state = { signedIn: false, next: [], settings: Core.normalizeSettings({}) };
  var autostart = false;
  var signingIn = false;
  var linking = false;
  var acctErr = '';

  var PLANE = '<svg class="art" viewBox="0 0 200 110" aria-hidden="true"><path d="M22 62c0-8 12-14 30-14h92c24 0 40 6 40 13s-16 13-40 13H50c-18 0-28-4-28-12z"/><path d="M52 48 40 22h18l30 26"/><path d="M92 74l26 26h14l-18-26"/><path d="M92 48l26-26h14l-18 26"/><path d="M150 56h.01M132 56h.01M114 56h.01M96 56h.01M78 56h.01"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function leadLabel(s) { return s < 60 ? s + ' seconds' : (s / 60) + (s === 60 ? ' minute' : ' minutes'); }
  var ALARM_NAMES = { jingle: 'Jingle', buzz: 'Buzz', bell: 'Bell', beep: 'Beep', off: 'Off' };

  function accountsBlock() {
    var list = (state.me && state.me.accounts) || [];
    var rows = list.map(function (a) {
      var tag = a.error ? ' <span class="tag">sign in again</span>' : a.primary ? ' <span class="tag">main</span>' : '';
      var rm = list.length > 1 ? '<button class="btn ghost small" data-remove="' + esc(a.id) + '">Remove</button>' : '';
      return '<div class="acct"><span class="em">' + esc(a.email) + tag + '</span>' + rm + '</div>';
    }).join('');
    if (!rows) rows = '<div class="acct"><span class="em">' + esc((state.me && state.me.email) || '') + '</span></div>';
    return '<h2>Accounts</h2>' + rows +
      '<div class="stack" style="margin-top:10px"><button class="btn ghost" id="addacct">' + (linking ? 'Waiting for your browser\u2026' : '+ Add another Google account') + '</button>' + (acctErr ? '<p class="errnote">' + esc(acctErr) + '</p>' : '') + '</div>';
  }

  function render() {
    if (!state.signedIn) {
      app.innerHTML = PLANE + '<h1>MeetingPlz.</h1><p>A reminder you can\u2019t miss, two minutes before every meeting.</p>' +
        '<div class="stack"><button class="btn" id="signin">' + (signingIn ? 'Waiting for your browser\u2026' : 'Continue with Google') + '</button></div>' +
        '<h2>Launch</h2>' + autostartRow();
      document.getElementById('signin').onclick = signIn;
      bindAutostart();
      return;
    }
    var s = state.settings;
    var list = (state.next || []).map(function (e) {
      var st = Core.toMs(e.start);
      return '<div class="meeting"><b>' + esc(e.title || 'Meeting') + '</b><span>' + fmt(st) + (e.attendees ? ' \u00b7 ' + esc(e.attendees) : '') + '</span>' + (e.calendar ? '<span class="cal">' + esc(e.calendar) + '</span>' : '') + '</div>';
    }).join('') || '<div class="empty">No meetings coming up.</div>';
    app.innerHTML =
      '<div class="who"><h1 style="font-size:26px">MeetingPlz.</h1><button class="btn ghost small" id="signout">Sign out</button></div>' +
      accountsBlock() +
      '<h2>Next up</h2>' + list +
      '<div class="stack"><button class="btn" id="test">Test it</button></div>' +
      '<h2>Reminder</h2>' +
      '<div class="row"><label>Remind me</label><select id="lead">' + Core.LEAD_OPTIONS.map(function (v) { return '<option value="' + v + '"' + (v === s.leadSeconds ? ' selected' : '') + '>' + leadLabel(v) + ' before</option>'; }).join('') + '</select></div>' +
      '<div class="row"><label>Style</label><div class="seg" id="style"><button data-v="flyby" class="' + (s.style === 'flyby' ? 'on' : '') + '">Flyby</button><button data-v="takeover" class="' + (s.style === 'takeover' ? 'on' : '') + '">Takeover</button></div></div>' +
      '<div class="row"><label>Alarm</label><select id="alarm">' + Core.ALARM_OPTIONS.map(function (v) { return '<option value="' + v + '"' + (v === s.alarm ? ' selected' : '') + '>' + ALARM_NAMES[v] + '</option>'; }).join('') + '</select></div>' +
      autostartRow();
    document.getElementById('signout').onclick = function () { MP.logout().then(function () { return MP.invoke('sign_out'); }); };
    document.getElementById('addacct').onclick = addAccount;
    document.querySelectorAll('[data-remove]').forEach(function (b) {
      b.onclick = function () { removeAccount(b.dataset.remove); };
    });
    document.getElementById('test').onclick = function () { MP.emit('test-it'); };
    document.getElementById('lead').onchange = function (e) { save({ leadSeconds: Number(e.target.value) }); };
    document.getElementById('alarm').onchange = function (e) { save({ alarm: e.target.value }); };
    document.querySelectorAll('#style button').forEach(function (b) { b.onclick = function () { save({ style: b.dataset.v }); }; });
    bindAutostart();
  }

  function autostartRow() {
    return '<div class="row"><label for="auto">Launch at login</label><input type="checkbox" class="switch" id="auto"' + (autostart ? ' checked' : '') + '></div>';
  }
  function bindAutostart() {
    var el = document.getElementById('auto');
    if (el) el.onchange = async function () { autostart = await MP.invoke('set_autostart', { enabled: el.checked }); };
  }

  async function save(partial) {
    state.settings = Object.assign({}, state.settings, partial);
    render();
    try { await MP.putSettings(partial); } catch (e) {}
    MP.emit('refresh');
  }

  async function addAccount() {
    acctErr = ''; linking = true; render();
    try { await MP.linkAccount(); } catch (e) { linking = false; acctErr = 'Could not start that. Try again.'; render(); return; }
    // the system browser finishes the flow; the app is told through 'auth-changed' (-> refresh -> state-changed)
    setTimeout(function () { if (linking) { linking = false; render(); } }, 120000);
  }

  async function removeAccount(id) {
    acctErr = '';
    try { await MP.removeAccount(id); } catch (e) { acctErr = 'Could not remove that account.'; render(); return; }
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
    autostart = await MP.invoke('get_autostart');
    MP.listen('state-changed', function (e) { apply(e.payload); });
    MP.listen('link-result', function (e) {
      var r = e.payload || {};
      linking = false;
      acctErr = r.ok ? '' : (r.status === 409 ? 'That Google account already belongs to another MeetingPlz account.' : 'Could not add that account. Try again.');
      render();
    });
    var cur = await MP.invoke('get_state');
    if (cur) apply(cur); else render();
    MP.emit('refresh');
  }
  window.addEventListener('DOMContentLoaded', init);
})();
