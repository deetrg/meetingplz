'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const T0 = Date.parse('2026-10-25T09:00:00Z');
const mk = (o) => Object.assign({ key: 'k1', id: 'e1', title: 'Quick sync', start: T0, end: T0 + 1800000, link: 'https://meet.google.com/abc-defg-hij', attendeeCount: 3, allDay: false, declined: false }, o);

test('isMeeting: link, guest, organizer', () => {
  assert.equal(C.isMeeting(mk({})), true);
  assert.equal(C.isMeeting(mk({ link: '', attendeeCount: 2 })), true);
  assert.equal(C.isMeeting(mk({ link: '', attendeeCount: 1 })), false);
  assert.equal(C.isMeeting({ title: 'x', start: T0, organizer: { self: false, email: 'a@b.com' } }), true);
  assert.equal(C.isMeeting({ title: 'x', start: T0, location: 'Zoom: https://us02web.zoom.us/j/123' }), true);
  assert.equal(C.isMeeting({ title: 'Focus', start: T0, organizer: { self: true } }), false);
});

test('isMeeting: skips non-meetings', () => {
  assert.equal(C.isMeeting(mk({ allDay: true })), false);
  assert.equal(C.isMeeting(mk({ declined: true })), false);
  assert.equal(C.isMeeting(mk({ status: 'cancelled' })), false);
  for (const eventType of ['outOfOffice', 'focusTime', 'workingLocation', 'birthday']) assert.equal(C.isMeeting(mk({ eventType })), false);
  assert.equal(C.isMeeting({ start: { date: '2026-10-25' }, hangoutLink: 'https://meet.google.com/a' }), false);
  assert.equal(C.isMeeting(null), false);
});

test('isMeeting: raw google attendees', () => {
  const raw = { start: { dateTime: '2026-10-25T09:00:00Z' }, attendees: [{ self: true, responseStatus: 'accepted' }, { email: 'miles@x.com' }] };
  assert.equal(C.isMeeting(raw), true);
  raw.attendees[0].responseStatus = 'declined';
  assert.equal(C.isMeeting(raw), false);
  assert.equal(C.isMeeting({ start: { dateTime: '2026-10-25T09:00:00Z' }, attendees: [{ self: true }] }), false);
});

test('pickDue window and once-only', () => {
  const s = { leadSeconds: 120 };
  const ev = mk({});
  assert.equal(C.pickDue([ev], T0 - 121000, s, new Set()).length, 0);
  assert.equal(C.pickDue([ev], T0 - 120000, s, new Set()).length, 1);
  assert.equal(C.pickDue([ev], T0, s, new Set()).length, 1);
  assert.equal(C.pickDue([ev], T0 + 599999, s, new Set()).length, 1);
  assert.equal(C.pickDue([ev], T0 + 600000, s, new Set()).length, 0);
  assert.equal(C.pickDue([ev], T0 - 60000, s, new Set(['k1'])).length, 0);
  assert.equal(C.pickDue([ev], T0 - 60000, s, ['k1']).length, 0);
  assert.equal(C.pickDue([ev], T0 - 60000, s, { k1: 1 }).length, 0);
  assert.equal(C.pickDue([ev], T0 - 60000, s).length, 1);
});

test('pickDue filters', () => {
  const now = T0 - 60000;
  assert.equal(C.pickDue([mk({ allDay: true })], now, {}, new Set()).length, 0);
  assert.equal(C.pickDue([mk({ declined: true })], now, {}, new Set()).length, 0);
  const solo = mk({ link: '', attendeeCount: 1 });
  assert.equal(C.pickDue([solo], now, {}, new Set()).length, 0);
  assert.equal(C.pickDue([solo], now, { meetingsOnly: false }, new Set()).length, 1);
  assert.equal(C.pickDue([mk({ allDay: true })], now, { meetingsOnly: false }, new Set()).length, 0);
  const bigLead = mk({ start: T0 + 400000, key: 'k2' });
  assert.equal(C.pickDue([bigLead], T0, { leadSeconds: 600 }, new Set()).length, 1);
  assert.equal(C.pickDue([bigLead], T0, { leadSeconds: 120 }, new Set()).length, 0);
  const sorted = C.pickDue([mk({ key: 'b', start: T0 + 60000 }), mk({ key: 'a', start: T0 })], T0 - 30000, {}, new Set());
  assert.deepEqual(sorted.map((e) => e.key), ['a', 'b']);
  assert.equal(C.pickDue([mk({ start: new Date(T0).toISOString() })], now, {}, new Set()).length, 1);
});

test('inText', () => {
  assert.equal(C.inText(120000), 'in 2 minutes');
  assert.equal(C.inText(118000), 'in 2 minutes');
  assert.equal(C.inText(60000), 'in 1 minute');
  assert.equal(C.inText(45000), 'in 45 seconds');
  assert.equal(C.inText(1000), 'in 1 second');
  assert.equal(C.inText(0), 'now');
  assert.equal(C.inText(-5000), 'now');
});

test('bannerText', () => {
  assert.equal(C.bannerText('Quick sync', 120000), 'QUICK SYNC \u00b7 IN 2 MIN');
  assert.equal(C.bannerText('Quick sync', 45000), 'QUICK SYNC \u00b7 IN 45 SEC');
  assert.equal(C.bannerText('Quick sync', 0), 'QUICK SYNC \u00b7 NOW');
  const long = C.bannerText('Quarterly planning with everyone', 120000);
  assert.ok(long.length <= 26, long);
  assert.ok(long.includes('\u2026 \u00b7 IN 2 MIN'), long);
  for (const ms of [600000, 120000, 45000, 0, -1000]) assert.ok(C.bannerText('x'.repeat(80), ms).length <= 26);
  assert.equal(C.bannerText('', 120000), 'MEETING \u00b7 IN 2 MIN');
});

test('providerLabel and extractMeetingLink', () => {
  assert.equal(C.providerLabel('https://meet.google.com/abc'), 'Join on Meet');
  assert.equal(C.providerLabel('https://us02web.zoom.us/j/123?pwd=x'), 'Join Zoom');
  assert.equal(C.providerLabel('https://teams.microsoft.com/l/meetup-join/x'), 'Join on Teams');
  assert.equal(C.providerLabel('https://acme.webex.com/meet/x'), 'Join Webex');
  assert.equal(C.providerLabel('https://whereby.com/room'), 'Join');
  assert.equal(C.providerLabel(''), 'Got it');
  assert.equal(C.providerLabel(null), 'Got it');
  assert.equal(C.extractMeetingLink(['no link', 'See https://us02web.zoom.us/j/123?pwd=a&amp;b=1.']), 'https://us02web.zoom.us/j/123?pwd=a&b=1');
  assert.equal(C.extractMeetingLink(['https://example.com/doc', 'https://meet.google.com/abc-defg-hij']), 'https://meet.google.com/abc-defg-hij');
  assert.equal(C.extractMeetingLink(['https://example.com/doc']), '');
  assert.equal(C.extractMeetingLink(null), '');
  assert.equal(C.extractMeetingLink('<a href="https://teams.microsoft.com/l/meetup-join/1">x</a>'), 'https://teams.microsoft.com/l/meetup-join/1');
});

test('fmtClock', () => {
  assert.equal(C.fmtClock(118000), '1:58');
  assert.equal(C.fmtClock(117200), '1:58');
  assert.equal(C.fmtClock(120000), '2:00');
  assert.equal(C.fmtClock(0), '0:00');
  assert.equal(C.fmtClock(-42000), '0:42');
  assert.equal(C.fmtClock(-65000), '1:05');
  assert.equal(C.fmtClock(3725000), '1:02:05');
});

test('settings', () => {
  assert.deepEqual({ ...C.DEFAULT_SETTINGS }, { leadSeconds: 120, style: 'flyby', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 });
  assert.deepEqual(C.validateSettings({ leadSeconds: 300, style: 'takeover', alarm: 'bell', meetingsOnly: false, snoozeSeconds: 120, junk: 1 }),
    { leadSeconds: 300, style: 'takeover', alarm: 'bell', meetingsOnly: false, snoozeSeconds: 120 });
  assert.deepEqual(C.validateSettings({ leadSeconds: 7, style: 'x', alarm: 'siren', meetingsOnly: 'maybe', snoozeSeconds: 5 }), {});
  assert.deepEqual(C.validateSettings({ leadSeconds: '180' }), { leadSeconds: 180 });
  assert.deepEqual(C.validateSettings(null), {});
  assert.deepEqual(C.normalizeSettings({ style: 'takeover' }), { leadSeconds: 120, style: 'takeover', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 });
});

test('reminder helpers match core', async () => {
  const R = await import('../reminder/reminder.js');
  for (const ms of [600000, 125000, 120000, 61000, 60000, 45000, 1000, 0, -5000]) {
    assert.equal(R.inText(ms), C.inText(ms));
    assert.equal(R.fmtClock(ms), C.fmtClock(ms));
    for (const t of ['Quick sync', 'Quarterly planning with everyone', '']) assert.equal(R.bannerText(t, ms), C.bannerText(t, ms));
  }
  for (const l of ['', null, 'https://meet.google.com/a', 'https://x.zoom.us/j/1', 'https://teams.microsoft.com/l/x', 'https://a.webex.com/m', 'https://whereby.com/r']) assert.equal(R.providerLabel(l), C.providerLabel(l));
});

test('boarding pass copy: reminder mirrors core', async () => {
  const R = await import('../reminder/reminder.js');
  for (const ms of [120000, 1, 0, -42000]) {
    assert.equal(R.headline(ms), C.headline(ms));
    assert.equal(R.statusText(ms), C.statusText(ms));
    assert.equal(R.clockLabel(ms), C.clockLabel(ms));
  }
  assert.equal(C.headline(1000), 'Your meeting is boarding.');
  assert.equal(C.headline(-1000), 'Final call.');
  assert.equal(C.statusText(5), 'BOARDING');
  assert.equal(C.statusText(0), 'FINAL CALL');
  assert.equal(C.clockLabel(5), 'BOARDS IN');
  assert.equal(C.clockLabel(-5), 'LATE BY');
  for (const l of ['', null, 'https://meet.google.com/a', 'https://x.zoom.us/j/1', 'https://teams.microsoft.com/l/x', 'https://a.webex.com/m', 'https://whereby.com/r']) assert.equal(R.gateLabel(l), C.gateLabel(l));
  assert.equal(C.gateLabel('https://meet.google.com/a'), 'Google Meet');
  assert.equal(C.gateLabel(''), '\u2014');
  for (const a of ['', null, 'with Miles', 'with Miles and 3 others', 'with Anna and 1 other', ['Miles', 'Anna', 'Lee'], [{ name: 'Miles' }]]) assert.equal(R.withText(a), C.withText(a));
  assert.equal(C.withText('with Miles and 3 others'), 'Miles +3');
  assert.equal(C.withText('with Anna and 1 other'), 'Anna +1');
  assert.equal(C.withText('with Miles'), 'Miles');
  assert.equal(C.withText(''), '');
  for (const c of ['1:58', '0:42', '12:05', '1:02:03']) assert.equal(R.padClock(c), C.padClock(c));
  assert.equal(C.padClock('1:58'), '01:58');
  assert.equal(C.padClock('12:05'), '12:05');
});

test('fonts.js is generated and registers the MPZ families', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const F = require('../design/fonts.js');
  assert.deepEqual(F.FAMILIES, { serif: 'MPZ Serif', mono: 'MPZ Mono' });
  assert.deepEqual(F.FACES.map((f) => f.join('|')), ['MPZ Serif|normal|400', 'MPZ Serif|italic|400', 'MPZ Mono|normal|400', 'MPZ Mono|normal|500']);
  for (const f of ['InstrumentSerif-Regular', 'InstrumentSerif-Italic', 'GeistMono-Regular', 'GeistMono-Medium']) {
    const b64 = fs.readFileSync(path.join(__dirname, '../design/fonts', f + '.woff2')).toString('base64');
    assert.ok(fs.readFileSync(path.join(__dirname, '../design/fonts.js'), 'utf8').includes(b64.slice(0, 200)), f + ' is stale: run node shared/build.js');
  }
  const iife = fs.readFileSync(path.join(__dirname, '../reminder/reminder.iife.js'), 'utf8');
  assert.ok(iife.includes('MeetingPlzFonts'), 'iife must bundle fonts.js');
  return F.register().then((r) => assert.deepEqual(r, [])); // no FontFace in node: resolves to []
});

test('plane art: 1.75 stroke and accent tail stripe', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const plane = fs.readFileSync(path.join(__dirname, '../art/plane.svg'), 'utf8');
  assert.ok(plane.includes('stroke-width="1.75"') && plane.includes('#D4512A'));
  assert.ok(fs.existsSync(path.join(__dirname, '../art/clouds.svg')));
});

test('iife is in sync with reminder.js', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../reminder/reminder.js'), 'utf8');
  const iife = fs.readFileSync(path.join(__dirname, '../reminder/reminder.iife.js'), 'utf8');
  const strip = (s) => s.replace(/export default [^;]*;/, '').replace(/^export /gm, '').replace(/\s+/g, '');
  assert.ok(strip(iife).includes(strip(src)), 'run: node shared/build.js');
});
