/* MeetingPlz core helpers. UMD, zero dependencies.
 * Browser global: MeetingPlzCore. Node / bundlers: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MeetingPlzCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEADS = [30, 60, 120, 180, 300, 600];
  var STYLES = ['flyby', 'takeover'];
  var ALARMS = ['jingle', 'buzz', 'bell', 'beep', 'off'];
  var GRACE_MS = 10 * 60 * 1000; // keep firing window open this long after start

  var DEFAULT_SETTINGS = Object.freeze({
    leadSeconds: 120,
    style: 'flyby',
    alarm: 'jingle',
    meetingsOnly: true,
    snoozeSeconds: 60
  });

  /* ---------- time helpers ---------- */

  // Accepts ms number, ISO string, Date, or Google {dateTime|date}. Returns ms or NaN.
  function toMs(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') return Date.parse(v);
    if (typeof v === 'object') return toMs(v.dateTime || v.date);
    return NaN;
  }

  function isAllDayEvt(evt) {
    if (evt.allDay === true) return true;
    if (evt.start && typeof evt.start === 'object' && evt.start.date && !evt.start.dateTime) return true;
    return false;
  }

  /* ---------- meeting links ---------- */

  var URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;
  var PROVIDERS = [
    { id: 'meet', re: /^https?:\/\/(meet\.google\.com|g\.co\/meet)\//i, label: 'Join on Meet' },
    { id: 'zoom', re: /^https?:\/\/([a-z0-9-]+\.)*(zoom\.us|zoom\.com|zoomgov\.com)\//i, label: 'Join Zoom' },
    { id: 'teams', re: /^https?:\/\/(teams\.microsoft\.com|teams\.live\.com|teams\.microsoft\.us)\//i, label: 'Join on Teams' },
    { id: 'webex', re: /^https?:\/\/([a-z0-9-]+\.)*webex\.com\//i, label: 'Join Webex' }
  ];
  var OTHER_RE = /^https?:\/\/([a-z0-9-]+\.)*(whereby\.com|around\.co|gotomeeting\.com|goto\.com\/meeting|bluejeans\.com|chime\.aws|meet\.jit\.si|slack\.com\/huddle|discord\.gg|skype\.com|join\.skype\.com|livestorm\.co|ringcentral\.com\/j|meet\.lync\.com)/i;

  function cleanUrl(u) {
    return u.replace(/&amp;/g, '&').replace(/[.,;:!?]+$/, '');
  }

  function providerOf(link) {
    if (!link) return '';
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].re.test(link)) return PROVIDERS[i].id;
    return 'other';
  }

  function providerLabel(link) {
    if (!link || typeof link !== 'string') return 'Got it';
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].re.test(link)) return PROVIDERS[i].label;
    return 'Join';
  }

  // texts: array of strings (location, description, hangoutLink, ...) or one string. Returns best link or ''.
  function extractMeetingLink(texts) {
    if (texts == null) return '';
    if (!Array.isArray(texts)) texts = [texts];
    var urls = [];
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (typeof t !== 'string' || !t) continue;
      t = t.replace(/&amp;/g, '&');
      var m = t.match(URL_RE);
      if (m) for (var j = 0; j < m.length; j++) urls.push(cleanUrl(m[j]));
    }
    var k, u;
    for (k = 0; k < PROVIDERS.length; k++) {
      for (u = 0; u < urls.length; u++) if (PROVIDERS[k].re.test(urls[u])) return urls[u];
    }
    for (u = 0; u < urls.length; u++) if (OTHER_RE.test(urls[u])) return urls[u];
    return '';
  }

  /* ---------- is it a real meeting? ---------- */

  function guestsOf(evt) {
    if (Array.isArray(evt.attendeesList)) return evt.attendeesList;
    if (Array.isArray(evt.attendees)) return evt.attendees;
    return [];
  }

  function isMeeting(evt) {
    if (!evt || typeof evt !== 'object') return false;
    if (evt.status === 'cancelled') return false;
    if (isAllDayEvt(evt)) return false;
    if (evt.declined === true) return false;
    var et = evt.eventType;
    if (et && et !== 'default') return false; // outOfOffice, focusTime, workingLocation, birthday, fromGmail
    var guests = guestsOf(evt);
    // declined by me (raw Google shape)
    for (var i = 0; i < guests.length; i++) {
      var g = guests[i];
      if (g && g.self && g.responseStatus === 'declined') return false;
    }
    var link = evt.link || evt.hangoutLink || '';
    if (!link && evt.conferenceData && Array.isArray(evt.conferenceData.entryPoints)) {
      for (var e = 0; e < evt.conferenceData.entryPoints.length; e++) {
        var ep = evt.conferenceData.entryPoints[e];
        if (ep && ep.entryPointType === 'video' && ep.uri) { link = ep.uri; break; }
      }
    }
    if (!link) link = extractMeetingLink([evt.location, evt.description]);
    if (link) return true;

    var count = typeof evt.attendeeCount === 'number' ? evt.attendeeCount : guests.length;
    var others = 0;
    for (var a = 0; a < guests.length; a++) {
      var x = guests[a];
      if (x && !x.self && !x.resource) others++;
    }
    if (guests.length && others > 0) return true;
    if (!guests.length && count > 1) return true;
    if (evt.organizer && typeof evt.organizer === 'object' && evt.organizer.self === false &&
        !(evt.organizer.email || '').endsWith('calendar.google.com')) return true;
    // transparent (free) solo blocks and everything else: not a meeting
    if (typeof evt.isMeeting === 'boolean' && !guests.length && !evt.organizer) return evt.isMeeting;
    return false;
  }

  /* ---------- firing ---------- */

  function eventKey(evt) {
    if (evt.key) return String(evt.key);
    return (evt.id || evt.title || '') + '@' + toMs(evt.start);
  }

  function hasKey(fired, key) {
    if (!fired) return false;
    if (typeof fired.has === 'function') return fired.has(key);
    if (Array.isArray(fired)) return fired.indexOf(key) !== -1;
    return !!fired[key];
  }

  function normalizeSettings(s) {
    var out = {};
    var v = validateSettings(s || {});
    for (var k in DEFAULT_SETTINGS) out[k] = k in v ? v[k] : DEFAULT_SETTINGS[k];
    return out;
  }

  // Pure. Returns due events (sorted by start). Caller records eventKey(evt) in firedKeys.
  function pickDue(events, now, settings, firedKeys) {
    var s = normalizeSettings(settings);
    var lead = s.leadSeconds * 1000;
    var out = [];
    if (!Array.isArray(events)) return out;
    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      if (!evt) continue;
      var start = toMs(evt.start);
      if (isNaN(start)) continue;
      if (isAllDayEvt(evt) || evt.declined === true || evt.status === 'cancelled') continue;
      if (s.meetingsOnly && !isMeeting(evt)) continue;
      if (!(start - lead <= now && now < start + GRACE_MS)) continue;
      if (hasKey(firedKeys, eventKey(evt))) continue;
      out.push(evt);
    }
    out.sort(function (a, b) { return toMs(a.start) - toMs(b.start); });
    return out;
  }

  /* ---------- text ---------- */

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function inText(msUntilStart) {
    if (!(msUntilStart > 0)) return 'now';
    var secs = Math.ceil(msUntilStart / 1000);
    if (secs >= 60) return 'in ' + plural(Math.ceil(secs / 60), 'minute');
    return 'in ' + plural(secs, 'second');
  }

  function shortIn(ms) {
    if (!(ms > 0)) return 'NOW';
    var secs = Math.ceil(ms / 1000);
    if (secs >= 60) return 'IN ' + Math.ceil(secs / 60) + ' MIN';
    return 'IN ' + secs + ' SEC';
  }

  var BANNER_MAX = 26;
  function bannerText(title, ms) {
    var suffix = ' \u00b7 ' + shortIn(ms);
    var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().toUpperCase();
    if (!t) t = 'MEETING';
    var room = BANNER_MAX - suffix.length;
    if (t.length > room) t = t.slice(0, Math.max(1, room - 1)).replace(/\s+$/, '') + '\u2026';
    return t + suffix;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 118400 -> "1:58" (counts down, hits 0:00 at start); negative -> "0:42" (seconds late).
  function fmtClock(ms) {
    var secs = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
    if (!isFinite(secs)) secs = 0;
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  /* ---------- settings ---------- */

  // Returns only the valid keys found in `partial` (coerced). Safe to merge over stored settings.
  function validateSettings(partial) {
    var out = {};
    if (!partial || typeof partial !== 'object') return out;
    if ('leadSeconds' in partial) {
      var l = Number(partial.leadSeconds);
      if (LEADS.indexOf(l) !== -1) out.leadSeconds = l;
    }
    if ('style' in partial && STYLES.indexOf(partial.style) !== -1) out.style = partial.style;
    if ('alarm' in partial && ALARMS.indexOf(partial.alarm) !== -1) out.alarm = partial.alarm;
    if ('meetingsOnly' in partial) {
      var m = partial.meetingsOnly;
      if (m === true || m === 'true' || m === 1) out.meetingsOnly = true;
      else if (m === false || m === 'false' || m === 0) out.meetingsOnly = false;
    }
    if ('snoozeSeconds' in partial) {
      var z = Math.round(Number(partial.snoozeSeconds));
      if (z >= 30 && z <= 1800) out.snoozeSeconds = z;
    }
    return out;
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    LEAD_OPTIONS: LEADS.slice(),
    STYLE_OPTIONS: STYLES.slice(),
    ALARM_OPTIONS: ALARMS.slice(),
    GRACE_MS: GRACE_MS,
    toMs: toMs,
    isMeeting: isMeeting,
    eventKey: eventKey,
    pickDue: pickDue,
    inText: inText,
    bannerText: bannerText,
    providerOf: providerOf,
    providerLabel: providerLabel,
    extractMeetingLink: extractMeetingLink,
    fmtClock: fmtClock,
    validateSettings: validateSettings,
    normalizeSettings: normalizeSettings
  };
});
