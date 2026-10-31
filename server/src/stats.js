import { ALL_EVENTS, dayOf } from './metrics.js';

export const ADMIN_EMAIL = 'daitq3010@gmail.com';
// Own/team accounts are left out of every user count.
const OWN = "(lower(COALESCE(email,'')) IN ('daitq3010@gmail.com','dai@horuslabs.net') OR lower(COALESCE(email,'')) LIKE '%@nonolingo.com' OR lower(COALESCE(email,'')) LIKE '%@horuslabs.net')";
const EXTERNAL_IDS = `(SELECT id FROM users WHERE NOT ${OWN})`;
const RELEASES_URL = 'https://api.github.com/repos/deetrg/meetingplz/releases';
const RELEASE_TTL = 10 * 60000;
let releaseCache = { at: 0, data: null, error: '' };
export const _resetReleaseCache = () => { releaseCache = { at: 0, data: null, error: '' }; };

export const isAdmin = (user) => !!user && String(user.email || '').toLowerCase() === ADMIN_EMAIL;

async function releases(now) {
  if (releaseCache.data && now - releaseCache.at < RELEASE_TTL) return releaseCache.data;
  try {
    const res = await fetch(RELEASES_URL, { headers: { 'user-agent': 'meetingplz-stats', accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('github ' + res.status);
    const list = await res.json();
    const data = list.map((r) => ({
      tag: r.tag_name, published: (r.published_at || '').slice(0, 10),
      assets: (r.assets || []).map((a) => ({ name: a.name, downloads: a.download_count || 0 })),
    }));
    releaseCache = { at: now, data, error: '' };
    return data;
  } catch (e) {
    releaseCache.error = String((e && e.message) || e).slice(0, 80);
    return releaseCache.data; // stale copy if we have one, else null
  }
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export async function collectStats(env, now = Date.now()) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dayOf(now - i * 86400000));
  const since = days[days.length - 1];
  const { results: rows } = await env.DB.prepare('SELECT day, name, client, ref, count FROM metrics WHERE day >= ?').bind(since).all();

  const byDay = {}; const byRef = {}; const byClient = {}; const totals = {};
  for (const d of days) byDay[d] = {};
  for (const r of rows || []) {
    const add = (o, k) => { (o[k] = o[k] || {})[r.name] = ((o[k] || {})[r.name] || 0) + r.count; };
    if (byDay[r.day]) add(byDay, r.day);
    add(byRef, r.ref || '(none)');
    add(byClient, r.client);
    totals[r.name] = (totals[r.name] || 0) + r.count;
  }

  const one = async (sql, ...args) => ((await env.DB.prepare(sql).bind(...args).first()) || {}).n || 0;
  const cutoff = new Date(since + 'T00:00:00Z').getTime();
  const { results: created } = await env.DB.prepare(
    `SELECT date(created_at/1000,'unixepoch') AS d, COUNT(*) AS n FROM users WHERE created_at >= ? AND NOT ${OWN} GROUP BY d`,
  ).bind(cutoff).all();
  const createdByDay = {};
  for (const d of days) createdByDay[d] = 0;
  for (const r of created || []) if (r.d in createdByDay) createdByDay[r.d] = r.n;

  const gh = await releases(now);
  const assetTotals = {};
  for (const r of gh || []) for (const a of r.assets) assetTotals[a.name] = (assetTotals[a.name] || 0) + a.downloads;

  return {
    generatedAt: new Date(now).toISOString(),
    days, events: ALL_EVENTS,
    byDay, byRef, byClient, totals,
    users: {
      total: await one(`SELECT COUNT(*) AS n FROM users WHERE NOT ${OWN}`),
      createdByDay,
      linkedAccounts: await one(`SELECT COUNT(*) AS n FROM google_accounts WHERE user_id IN ${EXTERNAL_IDS}`),
      withMultipleAccounts: await one(`SELECT COUNT(*) AS n FROM (SELECT user_id FROM google_accounts WHERE user_id IN ${EXTERNAL_IDS} GROUP BY user_id HAVING COUNT(*) > 1)`),
      pushSubs: await one(`SELECT COUNT(*) AS n FROM push_subs WHERE user_id IN ${EXTERNAL_IDS}`),
      remindersFired48h: await one(`SELECT COUNT(*) AS n FROM fired WHERE user_id IN ${EXTERNAL_IDS} AND event_key NOT LIKE 'test%'`),
      remindersFired24h: await one(`SELECT COUNT(*) AS n FROM fired WHERE user_id IN ${EXTERNAL_IDS} AND event_key NOT LIKE 'test%' AND fired_at >= ?`, now - 86400000),
    },
    githubError: gh ? '' : releaseCache.error,
    github: gh ? { releases: gh.slice(0, 6), assetTotals, total: sum(assetTotals) } : null,
  };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n ? String(n) : '<span class="z">0</span>');

function matrix(rowKeys, data, events, labelHead) {
  const head = events.map((e) => `<th scope="col">${esc(e.replace(/_/g, ' '))}</th>`).join('');
  const body = rowKeys.map((k) => `<tr><th scope="row">${esc(k)}</th>${events.map((e) => `<td>${num((data[k] || {})[e] || 0)}</td>`).join('')}</tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th>${esc(labelHead)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderStatsHtml(s) {
  const refKeys = Object.keys(s.byRef).sort((a, b) => sum(s.byRef[b]) - sum(s.byRef[a]));
  const clientKeys = Object.keys(s.byClient).sort();
  const u = s.users;
  const kpi = (label, v) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
  const created = s.days.map((d) => `<tr><th scope="row">${esc(d)}</th><td>${num(u.createdByDay[d])}</td></tr>`).join('');
  let gh = `<p class="note">GitHub release counts are unavailable right now (${esc(s.githubError)}).</p>`;
  if (s.github) {
    const names = Object.keys(s.github.assetTotals).sort();
    gh = `<div class="scroll"><table><thead><tr><th>Release</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>` +
      s.github.releases.map((r) => `<tr><th scope="row">${esc(r.tag)}</th>${names.map((n) => `<td>${num((r.assets.find((a) => a.name === n) || {}).downloads || 0)}</td>`).join('')}</tr>`).join('') +
      `<tr class="sum"><th scope="row">All releases</th>${names.map((n) => `<td>${num(s.github.assetTotals[n])}</td>`).join('')}</tr></tbody></table></div>`;
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark">
<title>Stats · MeetingPlz</title>
<link rel="stylesheet" href="/shared/design/tokens.css">
<style>
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 var(--fs-15)/1.5 var(--sans)}
main{max-width:1240px;margin:0 auto;padding:var(--sp-6) var(--sp-5) var(--sp-8)}
h1{font:400 var(--fs-44)/1 var(--serif);margin:0 0 var(--sp-2);letter-spacing:-.01em}
h2{font:400 var(--fs-22)/1.1 var(--serif);margin:var(--sp-7) 0 var(--sp-3)}
.lab,.note,th,.kpi span{font:400 var(--fs-11)/1.2 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.note{text-transform:none;letter-spacing:0;font-size:var(--fs-13);margin:var(--sp-2) 0 0;line-height:1.5}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--sp-3);margin-top:var(--sp-5)}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:var(--sp-4)}
.kpi b{display:block;font:400 var(--fs-30)/1 var(--mono);margin-bottom:var(--sp-2)}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card)}
table{border-collapse:collapse;width:100%}
th,td{padding:10px 8px;text-align:right;border-bottom:1px solid var(--line)}
thead th{white-space:normal;vertical-align:bottom;line-height:1.3}
td,tbody th{white-space:nowrap}
th:first-child{padding-left:14px}
thead th{border-bottom:1px solid var(--line-strong)}
th:first-child,tbody th{text-align:left}
tbody th{color:var(--ink);text-transform:none;letter-spacing:0;font-size:var(--fs-13)}
td{font:400 var(--fs-15)/1.2 var(--mono);font-variant-numeric:tabular-nums}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
.z{color:var(--muted);opacity:.55}
.sum td,.sum th{border-top:1px solid var(--line-strong);font-weight:600}
</style></head><body><main>
<span class="lab">Private · last 7 days (UTC) · generated ${esc(s.generatedAt)}</span>
<h1>MeetingPlz stats</h1>
<p class="note">Anonymous first-party counters. Page and button events include our own test traffic; user counts leave out daitq3010@gmail.com, dai@horuslabs.net and any @nonolingo.com or @horuslabs.net address.</p>
<div class="kpis">${kpi('Users', u.total)}${kpi('Linked accounts', u.linkedAccounts)}${kpi('Users with 2+ accounts', u.withMultipleAccounts)}${kpi('Push subscriptions', u.pushSubs)}${kpi('Reminders fired, 24h', u.remindersFired24h)}${kpi('Reminders fired, 48h', u.remindersFired48h)}${kpi('Release downloads', s.github ? s.github.total : 'n/a')}</div>
<h2>Events by day</h2>${matrix(s.days, s.byDay, s.events, 'Day')}
<h2>Events by ref (7 days)</h2>${matrix(refKeys.length ? refKeys : ['(none)'], s.byRef, s.events, 'Ref')}
<h2>Events by client (7 days)</h2>${matrix(clientKeys.length ? clientKeys : ['web'], s.byClient, s.events, 'Client')}
<h2>Users created per day</h2><div class="scroll"><table><thead><tr><th>Day</th><th>Users</th></tr></thead><tbody>${created}</tbody></table></div>
<p class="note">Reminders fired come from the server's push table, which is pruned after 2 days.</p>
<h2>GitHub release downloads</h2>${gh}
</main></body></html>`;
}
