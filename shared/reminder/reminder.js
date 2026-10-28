/* MeetingPlz reminder (design v2: boarding pass). Zero dependencies, ES module.
 * reminder.iife.js is generated from this file by shared/build.js (global: MeetingPlzReminder).
 * Renders inside a closed shadow root on a fixed, full-viewport host. No external requests.
 * Fonts: registers the bundled Instrument Serif / Geist Mono through MeetingPlzFonts (shared/design/fonts.js, base64 + FontFace API)
 * when that global exists (the IIFE build includes it); otherwise falls back to Georgia / system mono. */

/* ---------------- art (kept in sync with shared/art/plane.svg by build.js) ---------------- */

export const PLANE_VIEWBOX = '0 0 240 100';
export const PLANE_INNER =
  '<path d="M66 40 L36 8 L16 8 L32 40 Z" fill="#FBF9F4"/>' +
  '<path d="M19.6 13.6 L38.8 13.6 L45.4 21.4 L23.2 21.4 Z" fill="#D4512A" stroke="none" data-a="1"/>' +
  '<path d="M60 56 L35 65 L51 65 L82 57 Z" fill="#FBF9F4"/>' +
  '<path d="M100 61 L66 91 L92 91 L154 61 Z" fill="#FBF9F4"/>' +
  '<path d="M27 38 L170 38 C198 38 222 46 232 54 C222 62 204 66 176 66 L84 66 C57 66 38 54 23 44 C20.5 42.2 22.5 39 27 38 Z" fill="#FBF9F4"/>' +
  '<rect x="112" y="69" width="36" height="14" rx="7" fill="#FBF9F4"/>' +
  '<path d="M120 72.5 v6"/>' +
  '<path d="M186 44 L202 44 L212 50"/>' +
  '<path d="M56 53 h.01 M72 53 h.01 M88 53 h.01 M104 53 h.01 M120 53 h.01 M136 53 h.01 M152 53 h.01" stroke-width="4.2"/>';

/* ---------------- tiny helpers (mirrors of core.js; test guards drift) ---------------- */

function toMs(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') return Date.parse(v);
  if (typeof v === 'object') return toMs(v.dateTime || v.date);
  return NaN;
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
export function inText(ms) {
  if (!(ms > 0)) return 'now';
  var s = Math.ceil(ms / 1000);
  return s >= 60 ? 'in ' + plural(Math.ceil(s / 60), 'minute') : 'in ' + plural(s, 'second');
}
function shortIn(ms) {
  if (!(ms > 0)) return 'NOW';
  var s = Math.ceil(ms / 1000);
  return s >= 60 ? 'IN ' + Math.ceil(s / 60) + ' MIN' : 'IN ' + s + ' SEC';
}
export function bannerText(title, ms) {
  var suffix = ' \u00b7 ' + shortIn(ms);
  var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().toUpperCase() || 'MEETING';
  var room = 26 - suffix.length;
  if (t.length > room) t = t.slice(0, Math.max(1, room - 1)).replace(/\s+$/, '') + '\u2026';
  return t + suffix;
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function fmtClock(ms) {
  var s = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
  if (!isFinite(s)) s = 0;
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(x) : m + ':' + pad2(x);
}
export function providerLabel(link) {
  if (!link || typeof link !== 'string') return 'Got it';
  if (/^https?:\/\/(meet\.google\.com|g\.co\/meet)\//i.test(link)) return 'Join on Meet';
  if (/^https?:\/\/([a-z0-9-]+\.)*(zoom\.us|zoom\.com|zoomgov\.com)\//i.test(link)) return 'Join Zoom';
  if (/^https?:\/\/(teams\.microsoft\.com|teams\.live\.com|teams\.microsoft\.us)\//i.test(link)) return 'Join on Teams';
  if (/^https?:\/\/([a-z0-9-]+\.)*webex\.com\//i.test(link)) return 'Join Webex';
  return 'Join';
}
export const _helpers = { inText: inText, bannerText: bannerText, fmtClock: fmtClock, providerLabel: providerLabel, gateLabel: gateLabel, withText: withText, padClock: padClock, headline: headline, statusText: statusText, clockLabel: clockLabel };

function snoozeLabel(sec) {
  sec = sec || 60;
  if (sec < 60) return 'Snooze ' + sec + ' sec';
  return 'Snooze ' + Math.round(sec / 60) + ' min';
}

function fmtRange(start, end) {
  if (isNaN(start)) return '';
  var opt = { hour: 'numeric', minute: '2-digit' };
  var a, b = '';
  try {
    a = new Date(start).toLocaleTimeString([], opt);
    if (!isNaN(end) && end > start) b = new Date(end).toLocaleTimeString([], opt);
  } catch (e) { return ''; }
  if (!b) return a;
  var ma = /\s?[AP]M$/i.exec(a), mb = /\s?[AP]M$/i.exec(b);
  if (ma && mb && ma[0].toLowerCase() === mb[0].toLowerCase()) a = a.slice(0, a.length - ma[0].length);
  return a + ' \u2192 ' + b;
}

/** Boarding-pass copy (mirrors core.js). */
export function headline(ms) { return ms > 0 ? 'Your meeting is boarding.' : 'Final call.'; }
export function statusText(ms) { return ms > 0 ? 'BOARDING' : 'FINAL CALL'; }
export function clockLabel(ms) { return ms > 0 ? 'BOARDS IN' : 'LATE BY'; }

/** GATE label for the boarding pass: where the meeting happens. */
export function gateLabel(link) {
  if (!link || typeof link !== 'string') return '\u2014';
  if (/^https?:\/\/(meet\.google\.com|g\.co\/meet)\//i.test(link)) return 'Google Meet';
  if (/^https?:\/\/([a-z0-9-]+\.)*(zoom\.us|zoom\.com|zoomgov\.com)\//i.test(link)) return 'Zoom';
  if (/^https?:\/\/(teams\.microsoft\.com|teams\.live\.com|teams\.microsoft\.us)\//i.test(link)) return 'Teams';
  if (/^https?:\/\/([a-z0-9-]+\.)*webex\.com\//i.test(link)) return 'Webex';
  return 'Link';
}

/** "with Miles and 3 others" -> "Miles +3"; array of names -> "Miles +3"; '' -> ''. */
export function withText(att) {
  if (Array.isArray(att)) {
    var names = att.map(function (a) { return typeof a === 'string' ? a : (a && (a.name || a.displayName || a.email)) || ''; }).filter(Boolean);
    if (!names.length) return '';
    return names.length > 1 ? names[0] + ' +' + (names.length - 1) : names[0];
  }
  var s = String(att == null ? '' : att).replace(/^\s*with\s+/i, '').trim();
  var m = /^(.*?)\s+and\s+(\d+)\s+others?$/i.exec(s);
  return m ? m[1] + ' +' + m[2] : s;
}

/** "1:58" -> "01:58" (pass countdown is minutes:seconds, zero padded). */
export function padClock(c) { return /^\d:\d\d$/.test(c) ? '0' + c : c; }

/* ---------------- alarm (WebAudio, synthesized) ---------------- */

var sharedCtx = null;
function getCtx() {
  var AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') { try { sharedCtx = new AC(); } catch (e) { return null; } }
  return sharedCtx;
}
function tone(ctx, dest, f, t0, dur, type, gain, f2) {
  var o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
}
/** Plays one burst of an alarm sound. kind: jingle | buzz | bell | beep | off. */
export function playAlarm(kind, opts) {
  if (!kind || kind === 'off') return;
  var ctx = getCtx(); if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
  var vol = (opts && typeof opts.volume === 'number' ? opts.volume : 0.5);
  var master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
  var t = ctx.currentTime + 0.03, i;
  if (kind === 'jingle') {
    var notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    for (i = 0; i < notes.length; i++) tone(ctx, master, notes[i], t + i * 0.13, i === notes.length - 1 ? 0.5 : 0.22, 'triangle', 0.5);
  } else if (kind === 'buzz') {
    for (i = 0; i < 3; i++) tone(ctx, master, 140, t + i * 0.26, 0.2, 'sawtooth', 0.35, 120);
  } else if (kind === 'bell') {
    var hits = [0, 0.9];
    for (i = 0; i < hits.length; i++) {
      tone(ctx, master, 880, t + hits[i], 1.6, 'sine', 0.5);
      tone(ctx, master, 1760, t + hits[i], 1.0, 'sine', 0.18);
      tone(ctx, master, 2637, t + hits[i], 0.5, 'sine', 0.08);
    }
  } else if (kind === 'beep') {
    for (i = 0; i < 3; i++) tone(ctx, master, 1000, t + i * 0.2, 0.11, 'square', 0.16);
  }
}

/* ---------------- styles (design v2: boarding pass) ---------------- */

var CSS = [
  ':host{all:initial}',
  '*,*::before,*::after{box-sizing:border-box}',
  '.stage{--paper:#F3EFE6;--surface:#FBF9F4;--ink:#171512;--ink2:#3A3631;--muted:#7A746A;--line:rgba(23,21,18,.12);--line2:rgba(23,21,18,.22);--accent:#D4512A;--soft:rgba(212,81,42,.10);--onink:#F3EFE6;',
  '--serif:"MPZ Serif","Instrument Serif",Georgia,"Times New Roman",serif;--mono:"MPZ Mono","Geist Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;',
  '--sans:-apple-system,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;--ease:cubic-bezier(.16,1,.3,1);',
  '--pw:clamp(120px,19cqw,240px);--t:clamp(20px,2.3cqw,32px);--shadow:drop-shadow(0 34px 34px rgba(23,21,18,.22)) drop-shadow(0 6px 10px rgba(23,21,18,.10));',
  'position:fixed;inset:0;container-type:size;pointer-events:none;color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
  'text-align:left;line-height:1.3;font-size:16px;letter-spacing:0;text-transform:none;font-weight:400;font-style:normal;font-variant-numeric:tabular-nums}',
  '.stage.in-box{position:absolute}',
  '.stage.dark{--paper:#13120F;--surface:#1C1A17;--ink:#F1EDE4;--ink2:#CFC9BE;--muted:#958F84;--line:rgba(241,237,228,.12);--line2:rgba(241,237,228,.22);--accent:#EE6A40;--soft:rgba(238,106,64,.14);--onink:#13120F;',
  '--shadow:drop-shadow(0 34px 34px rgba(0,0,0,.55)) drop-shadow(0 6px 10px rgba(0,0,0,.35))}',
  /* takeover veil, grain and faint departures board */
  '.veil{position:absolute;inset:0;background:var(--paper);opacity:0}',
  '.stage.takeover{pointer-events:auto}',
  '.stage.takeover .veil{opacity:1}',
  '.grain{position:absolute;inset:0;opacity:0;pointer-events:none;mix-blend-mode:multiply;background-size:240px 240px;',
  'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\'%3E%3Cfilter id=\'n\' x=\'0\' y=\'0\' width=\'100%25\' height=\'100%25\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'.85\' numOctaves=\'2\' seed=\'7\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix values=\'0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.6 -.35\'/%3E%3C/filter%3E%3Crect width=\'240\' height=\'240\' filter=\'url(%23n)\'/%3E%3C/svg%3E")}',
  '.stage.takeover .grain{opacity:.035}',
  '.stage.dark.takeover .grain{opacity:.05;mix-blend-mode:screen}',
  '.board{position:absolute;left:6cqw;right:6cqw;top:20%;bottom:6%;display:none;flex-direction:column;justify-content:space-around;opacity:.075;pointer-events:none;overflow:hidden}',
  '.stage.takeover .board{display:flex}',
  '.brow{display:flex;align-items:center;gap:3cqw;padding:2.2cqh 0;border-bottom:1px solid var(--ink);font:400 clamp(14px,1.6cqw,22px)/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}',
  '.brow .bt{flex:none;width:6ch}.brow .bn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font:400 clamp(20px,2.6cqw,34px)/1.1 var(--serif);text-transform:none;letter-spacing:-.01em}',
  '.brow .bn.bar{flex:none;height:0;border-top:2px solid var(--ink)}.brow .bs{flex:none;margin-left:auto}',
  /* plane + banner */
  '.sky{position:absolute;left:0;right:0;top:16%;height:0;overflow:visible}',
  '.stage.takeover .sky{top:11%}',
  '.fly{position:absolute;left:0;top:0;display:flex;align-items:flex-start;visibility:hidden;will-change:transform;transform:translate(-3000px,0)}',
  '.bob{display:flex;align-items:flex-start;animation:bob 2.4s ease-in-out infinite}',
  '@keyframes bob{0%,100%{transform:translateY(-3px) rotate(-.6deg)}50%{transform:translateY(4px) rotate(.8deg)}}',
  '.banner{position:relative;display:flex;align-items:center;padding-right:calc(var(--pw)*.1);margin-right:calc(var(--pw)*-.07);',
  'margin-top:calc(var(--pw)*.1833 - var(--t)/2);height:var(--t)}',
  '.rope{position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;background:var(--ink);opacity:.7}',
  '.tile{position:relative;flex:none;width:calc(var(--t)*.74);height:var(--t);margin-right:calc(var(--t)*.09);background:var(--surface);border:1px solid var(--line2);border-radius:calc(var(--t)*.12);',
  'display:flex;align-items:center;justify-content:center;font:500 calc(var(--t)*.58)/1 var(--mono);color:var(--ink);box-shadow:0 1px 0 var(--line);animation:flap .62s var(--ease) backwards;animation-delay:calc(var(--i)*26ms)}',
  '.tile::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;background:var(--line2)}',
  '.tile.sp{width:calc(var(--t)*.42);border:0;background:none;box-shadow:none;margin-right:0;animation:none}.tile.sp::after{display:none}',
  '@keyframes flap{0%{transform:perspective(200px) rotateX(-92deg);opacity:0}60%{opacity:1}100%{transform:none;opacity:1}}',
  '.plane{position:relative;flex:none;display:block;width:var(--pw);height:auto;overflow:visible;stroke:var(--ink);fill:none}',
  '.plane [fill="#FBF9F4"]{fill:var(--surface)}.plane [data-a]{fill:var(--accent)}',
  /* the pass */
  '.wrap{position:absolute;inset:0;display:grid;place-items:center;padding:16px;pointer-events:none}',
  '.pass{pointer-events:auto;position:relative;width:min(560px,92cqw);max-height:100%;opacity:0}',
  '.stage.flyby .pass{filter:var(--shadow)}',
  '.top,.bot{position:relative;background:var(--surface);border:1px solid var(--line)}',
  '.top{border-bottom:0;border-radius:18px 18px 0 0;padding:28px 32px 24px;',
  '-webkit-mask-image:radial-gradient(circle 9px at 0 100%,#0000 8.4px,#000 9px),radial-gradient(circle 9px at 100% 100%,#0000 8.4px,#000 9px);-webkit-mask-composite:source-in;',
  'mask-image:radial-gradient(circle 9px at 0 100%,#0000 8.4px,#000 9px),radial-gradient(circle 9px at 100% 100%,#0000 8.4px,#000 9px);mask-composite:intersect}',
  '.bot{border-top:0;border-radius:0 0 18px 18px;padding:24px 32px 28px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:20px 28px;',
  '-webkit-mask-image:radial-gradient(circle 9px at 0 0,#0000 8.4px,#000 9px),radial-gradient(circle 9px at 100% 0,#0000 8.4px,#000 9px);-webkit-mask-composite:source-in;',
  'mask-image:radial-gradient(circle 9px at 0 0,#0000 8.4px,#000 9px),radial-gradient(circle 9px at 100% 0,#0000 8.4px,#000 9px);mask-composite:intersect}',
  '.perf{position:relative;height:0;z-index:2;pointer-events:none}',
  '.perf::before,.perf::after{content:"";position:absolute;top:-9px;width:18px;height:18px;border-radius:50%;border:1px solid var(--line)}',
  '.perf::before{left:-9px;clip-path:inset(0 0 0 50%)}.perf::after{right:-9px;clip-path:inset(0 50% 0 0)}',
  '.perf i{position:absolute;left:18px;right:18px;top:-.5px;height:1px;background:repeating-linear-gradient(90deg,var(--line2) 0 5px,transparent 5px 10px)}',
  '.lbls{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}',
  '.lab{font:400 11px/1.3 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.chip{display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 9px;border:1px solid var(--line2);border-radius:6px;font:400 10.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);white-space:nowrap;flex:none}',
  '.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none;animation:pulse 2s ease-in-out infinite}',
  '@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--soft)}50%{opacity:.5;box-shadow:0 0 0 5px transparent}}',
  '.stage.late .chip{color:var(--accent);border-color:var(--accent)}.stage.late .chip::before{animation:none}',
  '.hl{margin:0;font:400 44px/1.02 var(--serif);letter-spacing:-.01em;color:var(--ink)}',
  '.w{display:inline-block;white-space:nowrap}',
  '.ch{display:inline-block;white-space:pre}',
  '.mtitle{margin:14px 0 0;font:400 30px/1.1 var(--serif);letter-spacing:-.005em;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}',
  '.info{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:6px 18px;margin-top:24px}',
  '.cell{min-width:0}',
  '.cell .lab{display:block;margin-bottom:5px}',
  '.val{font:400 14px/1.35 var(--mono);color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.from{margin-top:14px;font:400 12px/1.3 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.from b{font-weight:400;letter-spacing:.09em;text-transform:uppercase;font-size:11px;margin-right:8px}',
  '.count{min-width:0}',
  '.cap{display:block;margin-bottom:6px}',
  '.clock{display:block;font:400 56px/.95 var(--mono);letter-spacing:-.045em;color:var(--ink);white-space:nowrap}',
  '.stage.late .clock{color:var(--accent)}',
  '.acts{min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:12px}',
  'button{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;-webkit-tap-highlight-color:transparent;font-family:inherit;user-select:none;-webkit-user-select:none;touch-action:manipulation}',
  'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
  '.join{display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:12px;background:var(--ink);color:var(--onink);font:600 16px/1 var(--sans);letter-spacing:-.005em;white-space:nowrap;padding:0 18px;transition:background .16s,transform .12s}',
  '.join:hover{background:var(--ink2)}',
  '.join .arr{display:inline-block;font-weight:500;transition:transform .16s var(--ease)}.join:hover .arr{transform:translateX(3px)}',
  '.join:active{transform:scale(.98)}',
  '.sec{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 18px}',
  '.sb{padding:4px 1px;font:500 13.5px/1.2 var(--sans);color:var(--ink);text-decoration:underline;text-decoration-color:transparent;text-decoration-thickness:1px;text-underline-offset:4px;transition:text-decoration-color .16s,color .16s;white-space:nowrap}',
  '.sb:hover{text-decoration-color:currentColor}',
  '.sb:active{transform:scale(.98)}',
  '.hold{position:relative;color:var(--muted)}.hold:hover{color:var(--ink)}',
  '.hold .bar{position:absolute;left:1px;right:1px;bottom:0;height:2px;background:var(--accent);border-radius:1px;transform-origin:left center;transform:scaleX(0)}',
  /* mobile */
  '@container (max-width:480px){',
  '.pass{width:calc(100cqw - 16px)}.wrap{padding:8px}',
  '.top{padding:22px 20px 20px}.bot{padding:20px 20px 22px;grid-template-columns:1fr}',
  '.lbls{margin-bottom:18px}.hl{font-size:36px}.mtitle{font-size:26px;margin-top:12px}',
  '.info{grid-template-columns:1fr 1fr;margin-top:20px}.info .cell:nth-child(1){grid-column:1 / -1}',
  '.lbls .lab{font-size:10.5px;letter-spacing:.05em}',
  '.clock{font-size:52px}.join{height:52px}.sec{justify-content:space-between;gap:6px 10px}',
  '}',
  '@container (max-height:520px){.top{padding-top:20px;padding-bottom:16px}.bot{padding-top:16px;padding-bottom:20px}.hl{font-size:34px}.mtitle{font-size:24px;margin-top:8px}.info{margin-top:14px}.lbls{margin-bottom:12px}.clock{font-size:44px}}',
  '@media (prefers-reduced-motion:reduce){.bob,.tile,.chip::before{animation:none!important}.join .arr,.join{transition:none}}',
  '.stage.rm .bob,.stage.rm .tile,.stage.rm .chip::before{animation:none!important}'
].join('');

/* ---------------- main ---------------- */

var live = [];
var CROSS_MS = 3600;
var REPEAT_MS = 45000;
var HOLD_MS = 2000;

function mk(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function planeSvg() {
  return '<svg class="plane" viewBox="' + PLANE_VIEWBOX + '" fill="none" stroke="#171512" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PLANE_INNER + '</svg>';
}

function fontsReady() {
  var F = (typeof self !== 'undefined' && self.MeetingPlzFonts) || null;
  if (!F || !F.register) return null;
  try { return F.register(); } catch (e) { return null; }
}

function boardRows(evt, upcoming, startMs) {
  var rows = [], i;
  var list = Array.isArray(upcoming) ? upcoming.filter(function (u) { return u && u.key !== evt.key && !isNaN(toMs(u.start)); }).slice(0, 5) : [];
  if (list.length) {
    for (i = 0; i < list.length; i++) rows.push({ t: fmtClockTime(toMs(list[i].start)), n: list[i].title || 'Meeting', s: 'On time' });
    return rows;
  }
  var bars = [46, 31, 58, 38, 50];
  for (i = 0; i < 5; i++) rows.push({ t: fmtClockTime(startMs + (i + 1) * 1800000), bar: bars[i], s: 'On time' });
  return rows;
}
function fmtClockTime(ms) {
  if (isNaN(ms)) return '--:--';
  try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return '--:--'; }
}

/**
 * show({ event, settings, mode, isPrimary, onJoin, onSnooze, onDismiss, onPointerInCard, ...extras })
 *   event: { key, title, start, end, link, calendar, attendees } (start/end in ms or ISO)
 *   mode: 'flyby' | 'takeover' (default settings.style or 'flyby')
 *   extras: now() => ms, theme 'auto'|'light'|'dark', container, freezeAt (ms, QA), globalEnter, volume, upcoming (optional list for the takeover backdrop)
 * returns { update(evt), close(), element }
 */
export function show(opts) {
  opts = opts || {};
  if (typeof document === 'undefined') throw new Error('MeetingPlzReminder.show needs a DOM');
  var settings = opts.settings || {};
  var mode = opts.mode || settings.style || 'flyby';
  if (mode !== 'takeover') mode = 'flyby';
  var evt = opts.event || {};
  var nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
  var isPrimary = opts.isPrimary !== false;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var closed = false;
  var timers = [], anims = [], cleanups = [];
  var holdAnim = null, holdTimer = null;
  var inBox = !!(opts.container && opts.container !== document.documentElement && opts.container !== document.body);

  // one reminder per event key per page
  for (var k = live.length - 1; k >= 0; k--) if (live[k].key === (evt.key || evt.id || '') && live[k].key) live[k].close();

  var fontsP = fontsReady();

  var host = document.createElement('meetingplz-reminder');
  var imp = function (p, v) { host.style.setProperty(p, v, 'important'); };
  imp('all', 'initial'); imp('position', inBox ? 'absolute' : 'fixed'); imp('inset', '0'); imp('z-index', '2147483647');
  imp('display', 'block'); imp('pointer-events', 'none'); imp('visibility', 'visible'); imp('opacity', '1'); imp('transform', 'none');
  imp('margin', '0'); imp('padding', '0'); imp('border', '0'); imp('width', 'auto'); imp('height', 'auto');
  var root = host.attachShadow({ mode: 'closed' });
  var style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);

  var stage = mk('div', 'stage ' + mode + (inBox ? ' in-box' : ''));
  var dark = opts.theme === 'dark' || (opts.theme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) stage.classList.add('dark');
  if (reduced) stage.classList.add('rm');
  stage.innerHTML =
    '<div class="veil"></div><div class="grain"></div><div class="board" aria-hidden="true"></div>' +
    '<div class="sky"><div class="fly"><div class="bob"><div class="banner"><div class="rope"></div></div>' + planeSvg() + '</div></div></div>' +
    '<div class="wrap"><section class="pass" role="alertdialog" aria-modal="' + (mode === 'takeover') + '" aria-label="Meeting reminder">' +
      '<div class="top">' +
        '<div class="lbls"><span class="lab">MeetingPlz \u00b7 Boarding pass</span><span class="chip"></span></div>' +
        '<h1 class="hl"></h1><div class="mtitle"></div>' +
        '<div class="info">' +
          '<div class="cell"><span class="lab">Departs</span><div class="val v-dep"></div></div>' +
          '<div class="cell"><span class="lab">Gate</span><div class="val v-gate"></div></div>' +
          '<div class="cell"><span class="lab">With</span><div class="val v-with"></div></div>' +
        '</div>' +
        '<div class="from"><b>From</b><span class="v-from"></span></div>' +
      '</div>' +
      '<div class="perf"><i></i></div>' +
      '<div class="bot">' +
        '<div class="count"><span class="lab cap"></span><span class="clock"></span></div>' +
        '<div class="acts"><button class="join" type="button"></button>' +
          '<div class="sec"><button class="sb imin" type="button">I\u2019m in</button><button class="sb snooze" type="button"></button>' +
          '<button class="sb hold" type="button" aria-label="Press and hold to close"><span>Hold to close</span><div class="bar"></div></button></div></div>' +
      '</div>' +
    '</section></div>';
  root.appendChild(stage);

  var $ = function (s) { return stage.querySelector(s); };
  var card = $('.pass'), fly = $('.fly'), banner = $('.banner'), hl = $('.hl');
  var titleEl = $('.mtitle'), chipEl = $('.chip'), depEl = $('.v-dep'), gateEl = $('.v-gate'), withEl = $('.v-with'), fromEl = $('.from'), fromV = $('.v-from');
  var capEl = $('.cap'), clockEl = $('.clock'), joinBtn = $('.join'), iminBtn = $('.imin'), snoozeBtn = $('.snooze'), holdBtn = $('.hold');
  var holdBar = $('.bar'), boardEl = $('.board');

  var lastHead = '', lastBanner = '';
  var startMs = NaN;

  function track(a) { if (a) anims.push(a); return a; }
  function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }

  function setHeadline(text, animateIn) {
    if (text === lastHead) return;
    lastHead = text;
    hl.textContent = '';
    hl.setAttribute('aria-label', text);
    var words = text.split(' '), n = 0;
    for (var w = 0; w < words.length; w++) {
      var ws = mk('span', 'w');
      ws.setAttribute('aria-hidden', 'true');
      for (var c = 0; c < words[w].length; c++) {
        var ch = mk('span', 'ch', words[w][c]); ch.dataset.i = n++; ws.appendChild(ch);
      }
      hl.appendChild(ws);
      if (w < words.length - 1) hl.appendChild(document.createTextNode(' '));
    }
    if (animateIn && !reduced) {
      var chars = hl.querySelectorAll('.ch');
      for (var i = 0; i < chars.length; i++) {
        track(chars[i].animate([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 360, delay: i * 25, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
      }
    }
  }

  function buildBanner(text) {
    if (text === lastBanner) return;
    lastBanner = text;
    var old = banner.querySelectorAll('.tile'); for (var o = 0; o < old.length; o++) old[o].remove();
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var t = mk('div', chars[i] === ' ' ? 'tile sp' : 'tile', chars[i] === ' ' ? '' : chars[i]);
      t.style.setProperty('--i', i);
      banner.appendChild(t);
    }
  }

  function render(first) {
    var ms = startMs - nowFn();
    var late = ms <= 0;
    stage.classList.toggle('late', late);
    chipEl.textContent = statusText(ms);
    setHeadline(headline(ms), !first);
    capEl.textContent = clockLabel(ms);
    clockEl.textContent = padClock(fmtClock(ms));
    clockEl.setAttribute('aria-label', (late ? 'late by ' : 'boards ') + (late ? fmtClock(ms) : inText(ms)));
    return ms;
  }

  function renderStatic() {
    startMs = toMs(evt.start);
    var endMs = toMs(evt.end);
    titleEl.textContent = evt.title || 'Meeting';
    depEl.textContent = fmtRange(startMs, endMs) || '\u2014';
    gateEl.textContent = gateLabel(evt.link);
    var wt = withText(evt.attendees);
    withEl.textContent = wt || '\u2014';
    fromV.textContent = evt.calendar || ''; fromEl.style.display = evt.calendar ? '' : 'none';
    joinBtn.innerHTML = '';
    joinBtn.appendChild(document.createTextNode(providerLabel(evt.link)));
    var ar = mk('span', 'arr', '\u2192'); ar.setAttribute('aria-hidden', 'true'); joinBtn.appendChild(ar);
    snoozeBtn.textContent = snoozeLabel(settings.snoozeSeconds);
    if (mode === 'takeover') renderBoard();
  }

  function renderBoard() {
    boardEl.textContent = '';
    var rows = boardRows(evt, opts.upcoming, startMs);
    rows.forEach(function (r) {
      var row = mk('div', 'brow');
      row.appendChild(mk('span', 'bt', r.t));
      if (r.n) row.appendChild(mk('span', 'bn', r.n));
      else { var b = mk('span', 'bn bar'); b.style.width = r.bar + '%'; row.appendChild(b); }
      row.appendChild(mk('span', 'bs', r.s));
      boardEl.appendChild(row);
    });
  }

  /* ---- actions ---- */

  function stopAll() {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout); timers = [];
    clearInterval(tick); clearInterval(alarmTimer);
    if (holdTimer) clearTimeout(holdTimer);
    cleanups.forEach(function (f) { try { f(); } catch (e) {} });
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    var i = live.indexOf(handle); if (i >= 0) live.splice(i, 1);
    var done = function () { if (host.parentNode) host.parentNode.removeChild(host); };
    if (reduced || !stage.animate) done();
    else {
      var a = stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
      a.onfinish = done; setTimeout(done, 400);
    }
  }
  function act(name) {
    if (closed) return;
    var cb = name === 'join' ? opts.onJoin : name === 'snooze' ? opts.onSnooze : opts.onDismiss;
    try {
      if (name === 'join' && !cb && evt.link) window.open(evt.link, '_blank', 'noopener');
      else if (cb) {
        if (name === 'snooze') cb(evt, settings.snoozeSeconds || 60);
        else if (name === 'join') cb(evt);
        else cb(evt, name); // 'imin' | 'hold'
      }
    } catch (e) { if (typeof console !== 'undefined') console.error(e); }
    stopAll();
  }

  joinBtn.addEventListener('click', function () { act('join'); });
  iminBtn.addEventListener('click', function () { act('imin'); });
  snoozeBtn.addEventListener('click', function () { act('snooze'); });

  holdBtn.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    try { holdBtn.setPointerCapture(e.pointerId); } catch (x) {}
    holdAnim = holdBar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: HOLD_MS, easing: 'linear', fill: 'forwards' });
    holdTimer = setTimeout(function () { act('hold'); }, HOLD_MS);
  });
  function holdCancel() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdAnim) { holdAnim.cancel(); holdAnim = null; }
  }
  holdBtn.addEventListener('pointerup', holdCancel);
  holdBtn.addEventListener('pointercancel', holdCancel);
  holdBtn.addEventListener('lostpointercapture', holdCancel);
  holdBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  if (typeof opts.onPointerInCard === 'function' && mode === 'flyby') {
    card.addEventListener('pointerenter', function () { opts.onPointerInCard(true); });
    card.addEventListener('pointerleave', function () { opts.onPointerInCard(false); });
    card.addEventListener('touchstart', function () { opts.onPointerInCard(true); }, { passive: true });
  }

  var globalEnter = opts.globalEnter != null ? opts.globalEnter : mode === 'takeover';
  if (globalEnter) {
    var onKey = function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
      var ae = root.activeElement;
      if (ae && ae !== joinBtn && ae.tagName === 'BUTTON') return; // native click on the focused button
      e.preventDefault(); e.stopPropagation(); act('join');
    };
    window.addEventListener('keydown', onKey, true);
    cleanups.push(function () { window.removeEventListener('keydown', onKey, true); });
  }

  /* ---- alarm ---- */
  var alarm = settings.alarm || 'jingle';
  var alarmTimer = null;
  function ring() { if (!closed && isPrimary && alarm !== 'off') playAlarm(alarm, { volume: opts.volume }); }
  if (isPrimary && alarm !== 'off') {
    ring();
    alarmTimer = setInterval(ring, 6000);
    // autoplay policy: resume audio on the first user gesture in the page
    var unlock = function () { var c = getCtx(); if (c && c.state === 'suspended') c.resume(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) { window.addEventListener(n, unlock, true); });
    cleanups.push(function () { ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) { window.removeEventListener(n, unlock, true); }); });
  }

  /* ---- animation ---- */

  function stageW() { var r = stage.getBoundingClientRect(); return r.width || window.innerWidth || document.documentElement.clientWidth || 1024; }

  function pass() {
    if (closed || reduced) return null;
    var vw = stageW();
    buildBanner(bannerText(evt.title, startMs - nowFn()));
    fly.style.visibility = 'visible';
    fly.style.transform = 'translate(-3000px,0)';
    var W = fly.getBoundingClientRect().width;
    var H = fly.getBoundingClientRect().height;
    fly.style.top = (-H * 0.5) + 'px';
    var from = -W - 24, to = vw + 24;
    var dur = Math.round(CROSS_MS * Math.max(.55, Math.min(1.15, (to - from) / 1600 + .2)));
    var a = track(fly.animate([{ transform: 'translate(' + from + 'px,0)' }, { transform: 'translate(' + to + 'px,0)' }],
      { duration: dur, easing: 'linear', fill: 'forwards' }));
    a.onfinish = function () { fly.style.visibility = 'hidden'; };
    return { from: from, to: to, W: W, vw: vw, dur: dur };
  }

  function intro() {
    var veil = $('.veil');
    if (reduced) {
      track(card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }));
      if (mode === 'takeover') track(veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }));
      return;
    }
    var p = pass();
    var chars = Array.from(hl.querySelectorAll('.ch'));
    var sr = stage.getBoundingClientRect();
    var skyY = $('.sky').getBoundingClientRect().top;
    var planeW = parseFloat(getComputedStyle(fly.querySelector('.plane')).width) || 200;
    var firstDrop = Infinity;
    var pcx0 = p.W - planeW / 2; // plane centre within group
    chars.forEach(function (c, i) {
      var r = c.getBoundingClientRect();
      var cx = r.left - sr.left + r.width / 2;
      // time when plane centre passes this letter: from + pcx0 + (to-from)*t/T = cx
      var tHit = (cx - p.from - pcx0) / (p.to - p.from) * p.dur;
      tHit = Math.max(120, tHit);
      firstDrop = Math.min(firstDrop, tHit);
      var dy = skyY - (r.top + r.height / 2);
      var dur = Math.min(900, 520 + Math.abs(dy) * 0.35);
      track(c.animate([
        { transform: 'translateY(' + dy + 'px) rotate(' + (i % 2 ? 24 : -24) + 'deg) scale(.5)', opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: 'translateY(0) rotate(0deg) scale(1)', opacity: 1, offset: 0.72, easing: 'ease-out' },
        { transform: 'translateY(-7px) rotate(0deg)', opacity: 1, offset: 0.86, easing: 'ease-in' },
        { transform: 'translateY(0)', opacity: 1, offset: 1 }
      ], { duration: dur, delay: tHit, easing: 'cubic-bezier(.45,0,.9,.55)', fill: 'backwards' }));
    });
    // the pass rises (translateY 24 -> 0, opacity) under the dropping letters
    var cardAt = mode === 'takeover' ? 80 : Math.max(120, firstDrop - 460);
    track(card.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
      { duration: 640, delay: cardAt, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
    if (mode === 'takeover') track(veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both' }));

    if (mode === 'flyby') {
      var again = function () {
        if (closed) return;
        pass();
        later(again, REPEAT_MS);
      };
      later(again, REPEAT_MS);
    }
  }

  /* ---- boot ---- */

  renderStatic();
  render(true);
  var parent = inBox ? opts.container : document.documentElement;
  if (inBox) { try { if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'; } catch (e) {} }
  parent.appendChild(host);
  var handle = {
    key: evt.key || evt.id || '',
    element: host,
    update: function (e) {
      if (closed) return;
      evt = e || evt;
      renderStatic(); render(false);
      lastBanner = ''; // next pass rebuilds with new title
    },
    close: function () { stopAll(); }
  };
  live.push(handle);

  var tick = setInterval(function () { if (!closed) render(false); }, 250);

  card.style.opacity = reduced ? '1' : '0';
  var started = false;
  function go() {
    if (started || closed) return;
    started = true;
    intro();
    if (reduced) card.style.opacity = '1';
    if (mode === 'takeover') { try { joinBtn.focus({ preventScroll: true, focusVisible: false }); } catch (e) {} }
    if (typeof opts.freezeAt === 'number') {
      clearInterval(tick); clearInterval(alarmTimer);
      anims.forEach(function (a) { try { a.currentTime = opts.freezeAt; a.pause(); } catch (e) {} });
      stage.querySelectorAll('.bob,.chip').forEach(function (n) { n.style.animationPlayState = 'paused'; });
      stage.querySelectorAll('.tile').forEach(function (n) { n.style.animation = 'none'; });
    }
  }
  // wait (briefly) for the bundled fonts so the letter-drop measures the real headline
  if (fontsP && fontsP.then) { fontsP.then(go, go); later(go, 260); } else go();

  return { update: handle.update, close: handle.close, element: host };
}

export default { show: show, playAlarm: playAlarm };
