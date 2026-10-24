import core from './vendor/core.cjs';
import { loadUpcoming } from './events.js';
import { sendWebPush } from './push.js';

export function buildPayload(evt, now) {
  const rem = evt.start - now;
  const when = rem >= 60000 ? `in ${Math.ceil(rem / 60000)} min` : rem > 0 ? `in ${Math.ceil(rem / 1000)} sec` : 'now';
  return {
    title: 'Join the meeting.',
    body: `${evt.title} starts ${when} \u00b7 ${core.providerLabel(evt.link)}`,
    tag: evt.key,
    data: { url: evt.link || '/app', key: evt.key, title: evt.title, start: evt.start, link: evt.link || '' },
    actions: [
      { action: 'join', title: 'Join' },
      { action: 'snooze', title: 'Snooze 1 min' },
    ],
  };
}

export async function pushToUser(env, userId, payload, send = sendWebPush) {
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').bind(userId).all();
  let sent = 0;
  for (const sub of results || []) {
    try {
      const r = await send(env, sub, payload);
      if (r.ok) sent++;
      if (r.gone) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
    } catch { /* one dead endpoint must not stop the others */ }
  }
  return sent;
}

export async function processUser(env, user, now, send) {
  const settings = core.normalizeSettings(JSON.parse(user.settings_json || '{}'));
  const events = await loadUpcoming(env, user, { maxAgeMs: 5 * 60 * 1000, now });
  const { results: firedRows } = await env.DB.prepare('SELECT event_key FROM fired WHERE user_id = ?').bind(user.id).all();
  const fired = new Set((firedRows || []).map((r) => r.event_key));
  const out = [];
  const due = core.pickDue(events, now, settings, fired).filter((e) => e.start > now);
  for (const evt of due) {
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO fired (user_id, event_key, fired_at) VALUES (?, ?, ?)')
      .bind(user.id, evt.key, now).run();
    if (!claim.meta || claim.meta.changes !== 1) continue; // another run got it
    const sent = await pushToUser(env, user.id, buildPayload(evt, now), send);
    out.push({ key: evt.key, sent });
  }
  const { results: snoozed } = await env.DB.prepare('SELECT event_key FROM snoozes WHERE user_id = ? AND until <= ?').bind(user.id, now).all();
  for (const s of snoozed || []) {
    await env.DB.prepare('DELETE FROM snoozes WHERE user_id = ? AND event_key = ?').bind(user.id, s.event_key).run();
    const evt = events.find((e) => e.key === s.event_key);
    if (evt && evt.start + core.GRACE_MS > now) {
      out.push({ key: evt.key, snoozed: true, sent: await pushToUser(env, user.id, buildPayload(evt, now), send) });
    }
  }
  return out;
}

export async function runCron(env, now = Date.now(), send) {
  const { results: users } = await env.DB.prepare(
    'SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM push_subs p WHERE p.user_id = u.id)',
  ).all();
  const report = [];
  for (const user of users || []) {
    try {
      report.push(...(await processUser(env, user, now, send)));
    } catch (e) {
      console.log('cron user error', user.id, String(e && e.message));
    }
  }
  if (new Date(now).getUTCMinutes() === 0) {
    const cutoff = now - 2 * 24 * 3600 * 1000;
    await env.DB.prepare('DELETE FROM fired WHERE fired_at < ?').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM snoozes WHERE until < ?').bind(cutoff).run();
    await env.DB.prepare('DELETE FROM sessions WHERE last_seen < ?').bind(now - 90 * 24 * 3600 * 1000).run();
  }
  return report;
}
