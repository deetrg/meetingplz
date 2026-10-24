/* STUB of shared/reminder/reminder.iife.js. Replaced by the real build when it lands. */
(function () {
  function show(opts) {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    var root = host.attachShadow({ mode: 'closed' });
    var ev = opts.event || {};
    var wrap = document.createElement('div');
    var full = opts.mode === 'takeover';
    wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:16px -apple-system,Segoe UI,system-ui,sans-serif;color:#111;' + (full ? 'background:#fff;pointer-events:auto' : '');
    wrap.innerHTML = '<div style="pointer-events:auto;background:#fff;border:2px solid #111;border-radius:20px;padding:28px;width:340px;box-shadow:0 18px 60px rgba(0,0,0,.28)">' +
      '<div style="font-weight:800;font-size:30px;letter-spacing:-.03em">Join the meeting.</div>' +
      '<div style="margin:6px 0 14px;color:#6b6b6b">Your meeting starts soon.</div><div style="font-weight:700">' + String(ev.title || '').replace(/</g, '&lt;') + '</div>' +
      '<button id="j" style="margin-top:16px;width:100%;padding:14px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:700;font-size:16px;cursor:pointer">Join</button>' +
      '<button id="s" style="margin-top:8px;width:100%;padding:10px;border:0;background:none;cursor:pointer">Snooze 1 min</button></div>';
    root.appendChild(wrap);
    root.getElementById ? 0 : 0;
    wrap.querySelector('#j').onclick = function () { opts.onJoin && opts.onJoin(); };
    wrap.querySelector('#s').onclick = function () { opts.onSnooze && opts.onSnooze(); };
    (document.body || document.documentElement).appendChild(host);
    return { update: function () {}, close: function () { host.remove(); } };
  }
  window.MeetingPlzReminder = { show: show };
})();
