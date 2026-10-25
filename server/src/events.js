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
      // same event on several calendars/accounts: prefer the copy where I am an attendee, else the first one seen
      if (!prev || (me && !prev._me)) { evt._me = !!me; byKey.set(key, evt); }
    }
  }
  return [...byKey.values()]
    .map(({ _me, ...e }) => e)
    .sort((a, b) => a.start - b.start);
}

export async function listAccounts(env, user) {
  const { results } = await env.DB.prepare('SELECT * FROM google_accounts WHERE user_id = ? ORDER BY added_at, id').bind(user.id).all();
  const rows = results || [];
  // primary (the account the user signed up with) goes first so its email wins ties
  rows.sort((a, b) => (b.google_sub === user.google_sub) - (a.google_sub === user.google_sub));
  return rows;
}

async function accountEvents(env, acct, now) {
  const refresh = await decryptToken(acct.refresh_token_enc, env.TOKEN_KEY);
  const at = await refreshAccessToken(env, refresh);
  const raw = await fetchRawEvents(at, now);
  // label every calendar of this account with the account's email
  return raw.map((r) => ({ calendarId: acct.email || r.calendarId, items: r.items }));
}

// Cached (D1) merged upcoming events for a user (all linked Google accounts).
// Throws GoogleAuthError only when no account can be read because of auth; a single bad account is
// marked (google_accounts.last_error = 'reauth') and skipped.
export async function loadUpcoming(env, user, { maxAgeMs = 90000, now = Date.now() } = {}) {
  const row = await env.DB.prepare('SELECT fetched_at, json FROM events_cache WHERE user_id = ?').bind(user.id).first();
  if (row && now - row.fetched_at < maxAgeMs) return JSON.parse(row.json);
  const accounts = (await listAccounts(env, user)).filter((a) => a.refresh_token_enc);
  if (!accounts.length) throw new GoogleAuthError('no_refresh_token');
  const live = accounts.filter((a) => a.last_error !== 'reauth');
  const settled = await Promise.allSettled(live.map((a) => accountEvents(env, a, now)));
  const rawAll = [];
  let transient = 0;
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      rawAll.push(...r.value);
      if (a.last_error) await env.DB.prepare('UPDATE google_accounts SET last_error = NULL WHERE id = ?').bind(a.id).run();
    } else if (r.reason instanceof GoogleAuthError) {
      await env.DB.prepare("UPDATE google_accounts SET last_error = 'reauth' WHERE id = ?").bind(a.id).run();
    } else {
      transient++;
    }
  }
  const okCount = settled.filter((r) => r.status === 'fulfilled').length;
  if (!okCount) {
    if (transient) {
      if (row) return JSON.parse(row.json); // serve stale on transient errors
      throw new Error('upstream');
    }
    throw new GoogleAuthError('all_accounts_need_reauth');
  }
  const events = mapEvents(rawAll);
  if (!transient) {
    await env.DB.prepare(
      'INSERT INTO events_cache (user_id, fetched_at, json) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET fetched_at = ?2, json = ?3',
    ).bind(user.id, now, JSON.stringify(events)).run();
  }
  return events;
}
