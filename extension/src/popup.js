(function () {
  var $ = function (id) { return document.getElementById(id); };
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { res(r || {}); }); } catch (e) { res({ error: String(e) }); }
    });
  }
  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inLabel(min, started) {
    if (started) return 'happening now';
    if (min == null) return '';
    return min <= 1 ? 'in 1 minute' : 'in ' + min + ' minutes';
  }
  var state = null;

  function renderNext(s) {
    var el = $('next');
    var ev = s.next;
    if (!ev) {
      el.innerHTML = '<div class="empty"><svg viewBox="0 0 64 64"><rect x="10" y="14" width="44" height="40" rx="8"/><path d="M10 26h44M22 8v10M42 8v10"/><path d="M23 40l7 7 12-14"/></svg><div class="title">No meetings coming up.</div><div class="meta">You are free for the next 24 hours.</div></div>';
      return;
    }
    var st = new Date(ev.start).getTime(), en = new Date(ev.end || ev.start).getTime();
    var started = st <= s.now;
    var label = ev.link ? (/meet\.google/.test(ev.link) ? 'Join on Meet' : /zoom\./.test(ev.link) ? 'Join Zoom' : /teams\./.test(ev.link) ? 'Join on Teams' : 'Join') : '';
    el.innerHTML = '<div class="eyebrow">Next up</div><div class="title">' + esc(ev.title) + '</div>' +
      '<div class="meta">' + fmtTime(st) + ' to ' + fmtTime(en) + ' \u00b7 ' + inLabel(s.minutes, started) + '</div>' +
      (ev.attendees ? '<div class="meta">' + esc(ev.attendees) + '</div>' : '') +
      (ev.calendar ? '<div class="cal">' + esc(ev.calendar) + '</div>' : '') +
      (label ? '<button class="btn outline join" id="joinnow">' + label + '</button>' : '');
    var j = $('joinnow');
    if (j) j.onclick = function () { chrome.tabs.create({ url: ev.link }); window.close(); };
  }

  function renderAccounts(me) {
    var list = (me && me.accounts) || [];
    $('accounts').innerHTML = list.map(function (a) {
      var tag = a.error ? ' <small>(sign in again)</small>' : a.primary ? ' <small>(main)</small>' : '';
      var rm = list.length > 1 ? '<button class="link" data-rm="' + esc(a.id) + '">Remove</button>' : '';
      return '<div class="acct"><span class="em">' + esc(a.email) + tag + '</span>' + rm + '</div>';
    }).join('');
  }

  function render(s) {
    state = s;
    $('out').hidden = !!s.signedIn;
    $('in').hidden = !s.signedIn;
    if (!s.signedIn) return;
    $('who').textContent = (s.me && s.me.email) || '';
    renderNext(s);
    renderAccounts(s.me);
    var set = s.settings || {};
    $('lead').value = String(set.leadSeconds || 120);
    $('alarm').value = set.alarm || 'jingle';
    [].forEach.call($('style').children, function (b) { b.classList.toggle('on', b.dataset.v === (set.style || 'flyby')); });
    if (s.apiBase) $('webapp').href = s.apiBase + '/app';
  }

  async function load(refresh) {
    var s = await send({ type: 'getState', refresh: !!refresh });
    render(s.error ? { signedIn: false } : s);
  }

  async function save(patch) {
    var r = await send({ type: 'saveSettings', patch: patch });
    if (r && r.settings) { state.settings = r.settings; render(state); }
  }

  $('signin').onclick = async function () {
    var b = $('signin'); b.disabled = true; $('err').hidden = true;
    var r = await send({ type: 'signIn' });
    b.disabled = false;
    if (r.error) { $('err').textContent = 'Could not sign in. Try again.'; $('err').hidden = false; return; }
    load(false);
  };
  function acctError(msg) { $('acct-err').textContent = msg || ''; $('acct-err').hidden = !msg; }
  $('addacct').onclick = async function () {
    var b = $('addacct'); b.disabled = true; acctError('');
    var r = await send({ type: 'addAccount' });
    b.disabled = false;
    if (r.error) acctError(r.error === 'account_in_use' ? 'That Google account is already used by another MeetingPlz account.' : r.error === 'calendar_access_needed' ? 'Tick the calendar box on Google\u2019s screen.' : 'Could not add that account. Try again.');
    load(false);
  };
  $('accounts').onclick = async function (e) {
    var id = e.target.dataset && e.target.dataset.rm;
    if (!id) return;
    e.target.disabled = true; acctError('');
    var r = await send({ type: 'removeAccount', id: id });
    if (r.error) acctError('Could not remove that account.');
    load(false);
  };
  $('signout').onclick = async function () { await send({ type: 'signOut' }); load(false); };
  $('test').onclick = function () {
    var b = $('test'); b.disabled = true; b.textContent = 'Watch the page\u2026';
    send({ type: 'test', delayMs: 2000 });
    setTimeout(function () { b.disabled = false; b.textContent = 'Test it'; }, 3500);
  };
  $('lead').onchange = function () { save({ leadSeconds: Number($('lead').value) }); };
  $('alarm').onchange = function () { save({ alarm: $('alarm').value }); };
  $('style').onclick = function (e) { var v = e.target.dataset && e.target.dataset.v; if (v) save({ style: v }); };

  load(false);
})();
