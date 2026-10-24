/* STUB of shared/core.js (same API shape). Used only if shared/core.js is missing at build time. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MeetingPlzCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEFAULT_SETTINGS = { leadSeconds: 120, style: 'flyby', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 };
  function toMs(v) { return typeof v === 'number' ? v : Date.parse(v); }
  function isMeeting(e) { return !!e && e.isMeeting !== false && !e.allDay && !e.declined; }
  function eventKey(e) { return e.key ? String(e.key) : (e.id || e.title || '') + '@' + toMs(e.start); }
  function normalizeSettings(s) { return Object.assign({}, DEFAULT_SETTINGS, s || {}); }
  function pickDue(events, now, settings, fired) {
    var s = normalizeSettings(settings), lead = s.leadSeconds * 1000;
    var has = function (k) { return fired && (typeof fired.has === 'function' ? fired.has(k) : !!fired[k]); };
    return (events || []).filter(function (e) {
      var st = toMs(e.start);
      return (!s.meetingsOnly || isMeeting(e)) && st - lead <= now && now < st + 300000 && !has(eventKey(e));
    }).sort(function (a, b) { return toMs(a.start) - toMs(b.start); });
  }
  function inText(ms) {
    if (!(ms > 0)) return 'now';
    var s = Math.ceil(ms / 1000);
    if (s >= 60) { var m = Math.ceil(s / 60); return 'in ' + m + (m === 1 ? ' minute' : ' minutes'); }
    return 'in ' + s + ' seconds';
  }
  function bannerText(t, ms) { return String(t || 'MEETING').toUpperCase() + ' \u00b7 ' + inText(ms).toUpperCase(); }
  function providerLabel(l) { return !l ? 'Got it' : /meet\.google/.test(l) ? 'Join on Meet' : /zoom\./.test(l) ? 'Join Zoom' : /teams\./.test(l) ? 'Join on Teams' : 'Join'; }
  function extractMeetingLink() { return null; }
  return { DEFAULT_SETTINGS: DEFAULT_SETTINGS, toMs: toMs, isMeeting: isMeeting, eventKey: eventKey, normalizeSettings: normalizeSettings,
    pickDue: pickDue, inText: inText, bannerText: bannerText, providerLabel: providerLabel, extractMeetingLink: extractMeetingLink };
});
