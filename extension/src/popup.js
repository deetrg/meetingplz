/* MeetingPlz popup (design v2): mini boarding pass for the next meeting, segmented quick settings, passport-stamp accounts. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var Core = window.MeetingPlzCore;
  var ART = window.MPZ_ART || {};
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { res(r || {}); }); } catch (e) { res({ error: String(e) }); }
    });
  }
  var timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var SITE = 'https://meetingplz.nonolingo.com';
  var LEADS = [[30, '30s'], [60, '1m'], [120, '2m'], [180, '3m'], [300, '5m'], [600, '10m']];
  var STYLES = [['flyby', 'Fly-by'], ['takeover', 'Takeover']];
  var ALARMS = [['jingle', 'Jingle'], ['buzz', 'Buzz'], ['bell', 'Bell'], ['beep', 'Beep'], ['off', 'Off']];
  var state = null;
  var skew = 0; // server now - local now
  var ticker = null;

  function nowMs() { return Date.now() + skew; }

  function segHtml(group, opts, cur) {
    return opts.map(function (o) {
      return '<button type="button" data-group="' + group + '" data-value="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>';
    }).join('');
  }

  function chip(ms, leadMs) {
    if (ms <= 0) return '<span class="chip chip--final">Final call</span>';
    if (ms <= leadMs) return '<span class="chip chip--boarding">Boarding</span>';
    return '<span class="chip">On time</span>';
  }

  function countdown(ms) {
    if (ms <= 0) return { label: 'Late by', value: Core.padClock(Core.fmtClock(ms)), cls: 'is-late' };
    if (ms >= 3600000) {
      var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return { label: 'Departs in', value: h + 'h ' + (m < 10 ? '0' : '') + m + 'm', cls: 'is-long' };
    }
    return { label: 'Boards in', value: Core.padClock(Core.fmtClock(ms)), cls: '' };
  }

  function renderNext(s) {
    var el = $('next');
    var ev = s.next;
    if (!ev) {
      el.innerHTML = '<div class="mini is-empty"><div class="empty">' + (ART.clouds || '') + '<p class="empty__t">Clear skies.</p><p class="empty__s">No meetings in the next 24 hours.</p></div></div>';
      return;
    }
    var st = Core.toMs(ev.start), en = Core.toMs(ev.end || ev.start);
    var lead = ((s.settings && s.settings.leadSeconds) || 120) * 1000;
    var ms = st - nowMs();
    var c = countdown(ms);
    var link = ev.link || '';
    var withTxt = Core.withText(ev.attendees);
    el.innerHTML =
      '<div class="mini">' +
      '<div class="mini__top"><div class="mini__bar"><span class="lab">Next up</span><span id="chip">' + chip(ms, lead) + '</span></div>' +
      '<h2 class="mini__t">' + esc(ev.title || 'Meeting') + '</h2>' +
      '<div class="mini__g"><div><span class="lab">Departs</span><span>' + esc(timeFmt.format(st)) + ' \u2192 ' + esc(timeFmt.format(en)) + '</span></div>' +
      '<div><span class="lab">Gate</span><span>' + esc(Core.gateLabel(link)) + '</span></div></div>' +
      ((withTxt || ev.calendar) ? '<div class="mini__from">' + esc([withTxt, ev.calendar].filter(Boolean).join(' \u00B7 ')) + '</div>' : '') + '</div>' +
      '<div class="mini__perf"></div>' +
      '<div class="mini__bot"><div><span class="lab" id="cd-l">' + c.label + '</span><span class="mini__c ' + c.cls + '" id="cd-v">' + c.value + '</span></div>' +
      (link ? '<button class="btn btn--primary btn--compact" id="joinnow" type="button" aria-label="' + esc(Core.providerLabel(link)) + '"><span>Join</span><span class="arr" aria-hidden="true">\u2192</span></button>' : '') +
      '</div></div>';
    var j = $('joinnow');
    if (j) j.onclick = function () { chrome.tabs.create({ url: link }); window.close(); };
  }

  function tickNext() {
    if (!state || !state.next) return;
    var st = Core.toMs(state.next.start), ms = st - nowMs();
    var lead = ((state.settings && state.settings.leadSeconds) || 120) * 1000;
    var c = countdown(ms);
    var v = $('cd-v'), l = $('cd-l'), ch = $('chip');
    if (!v) return;
    v.textContent = c.value; v.className = 'mini__c ' + c.cls; l.textContent = c.label; ch.innerHTML = chip(ms, lead);
  }

  function renderAccounts(me) {
    var list = (me && me.accounts) || [];
    $('accounts').innerHTML = list.map(function (a) {
      var tag = a.error ? '<span class="stamp__tag is-warn">Sign in again</span>' : a.primary ? '<span class="stamp__tag">Main</span>' : '';
      var rm = list.length > 1 ? '<button class="stamp__x" type="button" aria-label="Remove ' + esc(a.email) + '" data-rm="' + esc(a.id) + '">\u00D7</button>' : '';
      return '<span class="stamp"><span class="stamp__em">' + esc(a.email) + '</span>' + tag + rm + '</span>';
    }).join('');
  }

  function renderSettings(set) {
    $('lead').innerHTML = segHtml('leadSeconds', LEADS, set.leadSeconds || 120);
    $('style').innerHTML = segHtml('style', STYLES, set.style || 'flyby');
    $('alarm').innerHTML = segHtml('alarm', ALARMS, set.alarm || 'jingle');
  }

  function render(s) {
    state = s;
    $('out').hidden = !!s.signedIn;
    $('in').hidden = !s.signedIn;
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (!s.signedIn) { $('so-art').innerHTML = ART.plane || ''; return; }
    if (typeof s.now === 'number') skew = s.now - Date.now();
    $('who').textContent = (s.me && s.me.email) || '';
    renderNext(s);
    renderAccounts(s.me);
    renderSettings(s.settings || {});
    // public pages live on the custom domain (pages.dev 301-redirects there); only a dev apiBase override is used as-is
    var site = s.apiBase && !/pages\.dev/.test(s.apiBase) ? s.apiBase : SITE;
    $('webapp').href = site + '/app'; $('privacy').href = site + '/privacy'; $('terms').href = site + '/terms';
    ticker = setInterval(tickNext, 1000);
  }

  async function load(refresh) {
    var s = await send({ type: 'getState', refresh: !!refresh });
    render(s.error ? { signedIn: false } : s);
  }

  async function save(patch) {
    var r = await send({ type: 'saveSettings', patch: patch });
    if (r && r.settings) { state.settings = r.settings; renderSettings(state.settings); renderNext(state); }
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
    if (r.error) acctError(/account_in_use|409/.test(r.error) ? 'That Google account is already used by another MeetingPlz account.' : r.error === 'calendar_access_needed' ? 'Tick the calendar box on Google\u2019s screen.' : 'Could not add that account. Try again.');
    load(false);
  };
  $('accounts').onclick = async function (e) {
    var b = e.target.closest('[data-rm]');
    var id = b && b.dataset.rm;
    if (!id) return;
    b.disabled = true; acctError('');
    var r = await send({ type: 'removeAccount', id: id });
    if (r.error) acctError('Could not remove that account.');
    load(false);
  };
  $('signout').onclick = async function () { await send({ type: 'signOut' }); load(false); };
  $('test').onclick = function () {
    var b = $('test'), l = b.querySelector('.lbl');
    b.disabled = true; l.textContent = 'Watch the page\u2026';
    send({ type: 'test', delayMs: 2000 });
    setTimeout(function () { b.disabled = false; l.textContent = 'Test it'; }, 3500);
  };
  $('settings').onclick = function (e) {
    var b = e.target.closest('button[data-group]');
    if (!b) return;
    var g = b.dataset.group, v = b.dataset.value;
    var patch = {}; patch[g] = g === 'leadSeconds' ? Number(v) : v;
    state.settings = Object.assign({}, state.settings, patch);
    renderSettings(state.settings);
    save(patch);
  };

  load(false);
})();
