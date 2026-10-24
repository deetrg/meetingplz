/* STUB of shared/reminder/reminder.iife.js (used only until the shared file lands). */
(function (root) {
  root.MeetingPlzReminder = {
    show: function (o) {
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;pointer-events:none;' + (o.mode === 'takeover' ? 'background:#fff' : '');
      var card = document.createElement('div');
      card.style.cssText = 'pointer-events:auto;background:#fff;color:#111;border:2px solid #111;border-radius:20px;padding:28px;width:360px;font:16px system-ui;box-shadow:0 18px 60px rgba(0,0,0,.28)';
      var e = o.event || {};
      card.innerHTML = '<h1 style="margin:0 0 6px;font-weight:800">Join the meeting.</h1><p style="margin:0 0 16px;color:#6b6b6b">' + (e.title || '') + '</p>';
      var b = document.createElement('button');
      b.textContent = 'Join';
      b.style.cssText = 'background:#111;color:#fff;border:0;border-radius:999px;padding:12px 28px;font-weight:700;cursor:pointer';
      b.onclick = function () { o.onJoin && o.onJoin(); };
      var s = document.createElement('button');
      s.textContent = 'Snooze 1 min';
      s.style.cssText = 'background:none;border:0;margin-left:12px;cursor:pointer';
      s.onclick = function () { o.onSnooze && o.onSnooze(); };
      card.append(b, s);
      card.addEventListener('pointerenter', function () { o.onPointerInCard && o.onPointerInCard(true); });
      card.addEventListener('pointerleave', function () { o.onPointerInCard && o.onPointerInCard(false); });
      host.appendChild(card);
      document.body.appendChild(host);
      return { update: function () {}, close: function () { host.remove(); } };
    }
  };
})(window);
