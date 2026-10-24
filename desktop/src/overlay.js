/* One of these runs per monitor. Loads the shared reminder and reports actions back to Rust. */
(function () {
  var MP = window.MP;
  var win = window.__TAURI__.window.getCurrentWindow();
  var ignoring = false;
  var flyby = true;
  var inst = null;
  var key = null;
  var link = '';
  var done = false;

  function setIgnore(v) {
    if (v === ignoring) return;
    ignoring = v;
    MP.invoke('set_ignore_cursor', { ignore: v });
  }

  function act(action) {
    if (done) return;
    done = true;
    try { if (inst) inst.close(); } catch (e) {}
    MP.invoke('overlay_action', { action: action, key: key, link: action === 'join' ? link : null });
  }

  // Flyby is click-through outside the card. While the window ignores the mouse the page gets no
  // pointer events, so poll the OS cursor and hit-test it against the card ourselves.
  function startCursorWatch() {
    ignoring = true;
    var busy = false;
    setInterval(async function () {
      if (busy || done) return;
      busy = true;
      try {
        var p = await MP.invoke('cursor_in_window');
        if (p) {
          var el = document.elementFromPoint(p[0], p[1]);
          var inside = !!el && el !== document.documentElement && el !== document.body;
          setIgnore(!inside);
        }
      } catch (e) {} finally { busy = false; }
    }, 50);
  }

  async function init() {
    var payload = await MP.invoke('get_overlay_payload');
    if (!payload || !payload.event) { act('dismiss'); return; }
    key = payload.key;
    var ev = payload.event;
    link = ev.link || '';
    flyby = payload.mode !== 'takeover';
    var c = await MP.cfg();
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    MP.invoke('log_line', { line: 'prefers-reduced-motion: ' + reduced });
    var showOpts = {
      event: ev,
      settings: payload.settings,
      mode: payload.mode,
      isPrimary: !!payload.isPrimary,
      onJoin: function () { act('join'); },
      onSnooze: function () { act('snooze'); },
      onDismiss: function () { act('dismiss'); },
      onPointerInCard: function (inCard) { if (flyby) setIgnore(!inCard); }
    };
    if (typeof c.freezeMs === 'number') showOpts.freezeAt = c.freezeMs; // QA only
    inst = window.MeetingPlzReminder.show(showOpts);
    if (flyby) startCursorWatch();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      await ctx.resume();
      MP.invoke('log_line', { line: 'audio context: ' + ctx.state });
      ctx.close();
    } catch (e) { MP.invoke('log_line', { line: 'audio context error: ' + e }); }
  }
  window.addEventListener('DOMContentLoaded', init);
})();
