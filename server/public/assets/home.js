/* MeetingPlz homepage: OS-aware download button + the real reminder playing in a faux desktop window (scripted clock). */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (plat === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isWin = /Win/i.test(plat) || /Windows/i.test(ua);
  var isMac = !isIOS && (/Mac/i.test(plat) || /Macintosh/i.test(ua));
  var btn = document.getElementById('dl-main'), label = document.getElementById('dl-label');
  if (btn && label) {
    if (isWin) { btn.href = 'https://github.com/deetrg/meetingplz/releases/latest/download/MeetingPlz-windows-setup.exe'; btn.setAttribute('data-m', 'download_click_win'); label.textContent = 'Download for Windows'; }
    else if (isIOS) { btn.removeAttribute('data-m'); btn.href = '/iphone'; label.textContent = 'Get it on iPhone'; }
    else if (!isMac) { btn.removeAttribute('data-m'); btn.href = '#download'; label.textContent = 'Choose your download'; }
  }

  /* ---- live fly-by ---- */
  var win = document.getElementById('win');
  var R = window.MeetingPlzReminder;
  if (!win || !R) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SPEED = 7, SHOW_MS = 10800, GAP_MS = 1400;
  var handle = null, timer = null, visible = false, running = false, round = 0;

  function once() {
    if (!visible || document.hidden) { running = false; return; }
    running = true;
    var t0 = Date.now(), base = Date.now();
    var late = round % 3 === 2;                       // every third round plays the "Final call" state
    var start = base + (late ? -(8 * SPEED * 1000 / 8) : 120000);
    var evt = { key: 'home-demo-' + round, title: 'Quick sync with design', start: start, end: start + 30 * 60000, link: 'https://meet.google.com/abc-defg-hij', calendar: 'you@work.com', attendees: 'with Miles and 3 others' };
    round++;
    handle = R.show({
      event: evt, container: win, mode: 'flyby', isPrimary: false,
      settings: { alarm: 'off', snoozeSeconds: 60, style: 'flyby' },
      now: function () { return base + (Date.now() - t0) * SPEED; },
      onJoin: function () {}, onSnooze: function () {}, onDismiss: function () {}
    });
    if (reduced) return;                              // reduced motion: leave the pass up, no loop
    timer = setTimeout(function () { try { handle.close(); } catch (e) {} timer = setTimeout(once, GAP_MS); }, SHOW_MS);
  }
  function stop() { clearTimeout(timer); try { if (handle) handle.close(); } catch (e) {} handle = null; running = false; }
  function maybe() { if (visible && !document.hidden && !running) once(); else if ((!visible || document.hidden) && running) stop(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; maybe(); }, { threshold: 0.35 }).observe(win);
  } else { visible = true; maybe(); }
  document.addEventListener('visibilitychange', maybe);
})();
