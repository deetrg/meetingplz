/* STUB of shared/core.js (used only until the shared file lands). */
(function (root) {
  var D = { leadSeconds: 120, style: 'flyby', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 };
  function toMs(v) { return typeof v === 'number' ? v : Date.parse(v); }
  function eventKey(e) { return e.key || (e.id + '@' + toMs(e.start)); }
  function isMeeting(e) { return !!(e && !e.allDay && !e.declined && (e.link || e.attendeeCount > 1 || e.isMeeting)); }
  function normalizeSettings(s) { return Object.assign({}, D, s || {}); }
  function pickDue(events, now, settings, fired) {
    var s = normalizeSettings(settings);
    return (events || []).filter(function (e) {
      var st = toMs(e.start);
      return (!s.meetingsOnly || isMeeting(e)) && st - s.leadSeconds * 1000 <= now && now < st + 600000 && !(fired && fired.has(eventKey(e)));
    }).sort(function (a, b) { return toMs(a.start) - toMs(b.start); });
  }
  function providerLabel(l) { return !l ? 'Got it' : /meet\.google/.test(l) ? 'Join on Meet' : /zoom/.test(l) ? 'Join Zoom' : /teams/.test(l) ? 'Join on Teams' : 'Join'; }
  root.MeetingPlzCore = { DEFAULT_SETTINGS: D, toMs: toMs, eventKey: eventKey, isMeeting: isMeeting, normalizeSettings: normalizeSettings, pickDue: pickDue, providerLabel: providerLabel,
    LEAD_OPTIONS: [30, 60, 120, 180, 300, 600], ALARM_OPTIONS: ['jingle', 'buzz', 'bell', 'beep', 'off'] };
})(typeof self !== 'undefined' ? self : this);
