// First-party, anonymous funnel counters. No cookies, no IP, no user id: only (UTC day, event, client, campaign tag) -> count.
export const CLIENT_EVENTS = [
  'landing_view', 'download_click_mac', 'download_click_win', 'download_click_chrome', 'download_click_iphone',
  'web_signin_start', 'demo_start', 'reminder_shown', 'test_reminder',
];
// Written by the server itself (never accepted from POST /api/m).
export const SERVER_EVENTS = ['signin_ok', 'consent_missing', 'first_upcoming', 'user_created'];
export const ALL_EVENTS = [...CLIENT_EVENTS, ...SERVER_EVENTS];
export const METRIC_CLIENTS = ['web', 'ext', 'desktop', 'ios'];

export const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// utm_source / ref: lowercase letters, digits, dot, dash, underscore; 1-32 chars; anything else is dropped.
export function cleanRef(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z0-9._-]{1,32}$/.test(s) ? s : '';
}

export async function bump(env, name, client, ref) {
  try {
    await env.DB.prepare(
      `INSERT INTO metrics (day, name, client, ref, count) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(day, name, client, ref) DO UPDATE SET count = count + 1`,
    ).bind(dayOf(), name, METRIC_CLIENTS.includes(client) ? client : 'web', cleanRef(ref)).run();
  } catch (e) {
    console.log('metric failed', name, String(e && e.message));
  }
}

// Per-isolate limiter: a cap per caller bucket and a global cap, both per minute. Nothing is persisted; the bucket key is
// only held in memory for the minute (so a flood cannot burn the D1 write allowance).
const PER_CALLER = 40;
const GLOBAL = 600;
const buckets = { minute: 0, callers: new Map(), total: 0 };
export function allow(callerKey, nowMs = Date.now()) {
  const minute = Math.floor(nowMs / 60000);
  if (buckets.minute !== minute) { buckets.minute = minute; buckets.callers = new Map(); buckets.total = 0; }
  if (buckets.total >= GLOBAL) return false;
  const n = (buckets.callers.get(callerKey) || 0) + 1;
  if (n > PER_CALLER) return false;
  if (buckets.callers.size > 5000 && !buckets.callers.has(callerKey)) return false;
  buckets.callers.set(callerKey, n);
  buckets.total++;
  return true;
}
export const _resetLimiter = () => { buckets.minute = 0; buckets.callers = new Map(); buckets.total = 0; };

// POST /api/m { name, client, ref } -> 204 always for well-formed calls (even when rate-limited: the sender never retries).
export async function metricsHandler(request, env) {
  const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  let raw = '';
  try { raw = await request.text(); } catch { return noContent(); }
  if (raw.length > 512) return new Response(null, { status: 413 });
  let b = null;
  try { b = JSON.parse(raw); } catch { b = null; }
  if (!b || typeof b !== 'object' || !CLIENT_EVENTS.includes(b.name)) return new Response(null, { status: 400 });
  const client = METRIC_CLIENTS.includes(b.client) ? b.client : 'web';
  const caller = request.headers.get('cf-connecting-ip') || '';
  if (!allow(caller)) return noContent();
  await bump(env, b.name, client, b.ref);
  return noContent();
}
