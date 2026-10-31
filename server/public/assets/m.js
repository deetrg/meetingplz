/* MeetingPlz anonymous counters: no cookies, no IP, nothing tied to a person. Captures utm_source / ref once (localStorage) and
 * sends tiny non-blocking pings to our own /api/m. Elements with data-m="<event>" count a click; <body data-view="<event>"> counts a page view once per session. */
(function () {
  'use strict';
  var KEY = 'mp_ref', ref = '';
  function clean(v) { v = String(v || '').trim().toLowerCase(); return /^[a-z0-9._-]{1,32}$/.test(v) ? v : ''; }
  try {
    var p = new URLSearchParams(location.search);
    var q = clean(p.get('utm_source') || p.get('ref'));
    if (q) localStorage.setItem(KEY, q);
    ref = localStorage.getItem(KEY) || '';
  } catch (e) {}
  function send(name) {
    try {
      var body = JSON.stringify({ name: name, client: 'web', ref: ref });
      if (navigator.sendBeacon && navigator.sendBeacon('/api/m', new Blob([body], { type: 'text/plain' }))) return;
      fetch('/api/m', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }
  window.mpMetric = send;
  window.mpRef = function () { return ref; };
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-m], a[href^="/api/auth/google/start"]') : null;
    if (!t) return;
    var m = t.getAttribute('data-m');
    if (m) { send(m); return; }
    var href = t.getAttribute('href') || '';
    if (href.indexOf('scope=calendar') < 0) send('web_signin_start'); // the "one more step" retry is not a new sign-in
    if (ref && href.indexOf('ref=') < 0) t.setAttribute('href', href + (href.indexOf('?') < 0 ? '?' : '&') + 'ref=' + encodeURIComponent(ref));
  }, true);
  var view = document.body && document.body.getAttribute('data-view');
  if (view) { try { if (!sessionStorage.getItem('mp_v_' + view)) { sessionStorage.setItem('mp_v_' + view, '1'); send(view); } } catch (e) { send(view); } }
})();
