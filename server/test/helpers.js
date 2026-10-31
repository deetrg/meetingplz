import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { b64uEncode } from '../src/util.js';

// Minimal D1 look-alike on node:sqlite so the real SQL and schema run in tests.
export function makeDb() {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_google_accounts.sql', '0003_link_codes.sql', '0004_metrics.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() {
          const r = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return st;
    },
  };
}

export async function makeEnv(extra = {}) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(Buffer.from(jwk.x, 'base64url'), 1);
  pub.set(Buffer.from(jwk.y, 'base64url'), 33);
  return {
    DB: makeDb(),
    GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'csecret',
    TOKEN_KEY: b64uEncode(crypto.getRandomValues(new Uint8Array(32))),
    SESSION_PEPPER: 'pepper',
    VAPID_PUBLIC_KEY: b64uEncode(pub),
    VAPID_PRIVATE_KEY: jwk.d,
    TEST_DELAY_MS: 0,
    ...extra,
  };
}

export function idToken(claims) {
  const enc = (o) => b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'none' })}.${enc(claims)}.sig`;
}

// Install a fetch mock; routes are [matcher(url, init) => Response|undefined]. Returns { calls, restore }.
export function mockFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    return r || new Response('{}', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

export const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// Fake Google: oauth + calendar
export function googleMock({ events = [], scope = 'openid email profile https://www.googleapis.com/auth/calendar.readonly', refresh = 'rt-1', sub = 'sub-1', email = 'a@b.com', noIdToken = false } = {}) {
  return mockFetch((url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return jsonRes({ access_token: 'at', refresh_token: refresh, scope, ...(noIdToken ? {} : { id_token: idToken({ sub, email, name: 'Dai T', picture: 'https://p/x.png' }) }) });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return jsonRes({ sub, email, name: 'Dai T', picture: 'https://p/x.png' });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
      return jsonRes({ items: [{ id: email, selected: true, primary: true }, { id: 'x#holiday@group.v.calendar.google.com', selected: true }] });
    }
    if (url.includes('/calendar/v3/calendars/') && url.includes('/events')) return jsonRes({ items: events });
    if (url === 'https://oauth2.googleapis.com/revoke') return jsonRes({});
    return undefined;
  });
}
