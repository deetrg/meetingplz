import core from './vendor/core.cjs';
import { decryptToken } from './crypto.js';
import { GoogleAuthError, fetchRawEvents, refreshAccessToken } from './google.js';

const { isMeeting, extractMeetingLink, providerOf } = core;

function firstName(a) {
  const n = (a.displayName || '').trim();
  if (n) return n.split(/\s+/)[0];
  const local = (a.email || '').split('@')[0].split(/[._-]+/)[0] || '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}

export function attendeeText(attendees) {
  const others = (attendees || []).filter((a) => !a.self && !a.resource);
  if (!others.length) return '';
  if (others.length === 1) return `with ${firstName(others[0])}`;
  const n = others.length - 1;
  return `with ${firstName(others[0])} and ${n} other${n === 1 ? '' : 's'}`;
}

function startEndMs(v) {
  if (!v) return NaN;
  if (v.dateTime) return Date.parse(v.dateTime);
  if (v.date) return Date.parse(`${v.date}T00:00:00Z`);
  return NaN;
}

export function mapEvents(rawByCal) {
  const byKey = new Map();
  for (const { calendarId, items } of rawByCal) {
    for (const it of items) {
      if (it.status === 'cancelled') continue;
      const start = startEndMs(it.start);
      const end = startEndMs(it.end);
      if (!Number.isFinite(start)) continue;
      const allDay = !!(it.start && it.start.date && !it.start.dateTime);
      const attendees = (it.attendees || []).map((a) => ({ ...a, self: !!a.self }));
      const me = attendees.find((a) => a.self);
      const declined = !!(me && me.responseStatus === 'declined');
      const organizer = it.organizer ? { ...it.organizer, self: !!it.organizer.self } : undefined;
      let link = it.hangoutLink || '';
      if (!link && it.conferenceData && it.conferenceData.entryPoints) {
        const ep = it.conferenceData.entryPoints.find((e) => e.entryPointType === 'video' && e.uri);
        if (ep) link = ep.uri;
      }
      if (!link) link = extractMeetingLink([it.location, it.description]);
      const norm = { ...it, attendees, organizer, declined, link, allDay };
      const key = `${it.iCalUID || it.id}:${start}`;
      const evt = {
        key,
        id: it.id,
        title: it.summary || '(no title)',
        start,
        end: Number.isFinite(end) ? end : start,
        link: link || '',
        provider: link ? providerOf(link) : '',
        calendar: calendarId,
        attendees: attendeeText(attendees),
        attendeeCount: attendees.filter((a) => !a.resource).length,
        isMeeting: !!isMeeting(norm),
        allDay,
        declined,
      };
      const prev = byKey.get(key);
      // same event on several calendars: prefer the copy where I am an attendee
      if (!prev || (me && !prev._me)) { evt._me = !!me; byKey.set(key, evt); }
    }
  }
  return [...byKey.values()]
    .map(({ _me, ...e }) => e)
    .sort((a, b) => a.start - b.start);
}

// Cached (D1) upcoming events for a user row. Throws GoogleAuthError when re-auth is needed.
export async function loadUpcoming(env, user, { maxAgeMs = 90000, now = Date.now() } = {}) {
  const row = await env.DB.prepare('SELECT fetched_at, json FROM events_cache WHERE user_id = ?').bind(user.id).first();
  if (row && now - row.fetched_at < maxAgeMs) return JSON.parse(row.json);
  if (!user.refresh_token_enc) throw new GoogleAuthError('no_refresh_token');
  try {
    const refresh = await decryptToken(user.refresh_token_enc, env.TOKEN_KEY);
    const at = await refreshAccessToken(env, refresh);
    const events = mapEvents(await fetchRawEvents(at, now));
    await env.DB.prepare(
      'INSERT INTO events_cache (user_id, fetched_at, json) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET fetched_at = ?2, json = ?3',
    ).bind(user.id, now, JSON.stringify(events)).run();
    return events;
  } catch (e) {
    if (e instanceof GoogleAuthError) throw e;
    if (row) return JSON.parse(row.json); // serve stale on transient errors
    throw e;
  }
}
