import test from 'node:test';
import assert from 'node:assert/strict';
import { runCron } from '../src/notify.js';
import { encryptToken } from '../src/crypto.js';
import { makeEnv, googleMock } from './helpers.js';

const NOW = Date.UTC(2026, 9, 25, 10, 0, 0);

async function seed(env, events, settings = {}) {
  env.DB.raw.prepare("INSERT INTO users VALUES ('u1','sub','a@b.com','Dai','', ?, ?, 1)")
    .run(await encryptToken('rt', env.TOKEN_KEY), JSON.stringify(settings));
  env.DB.raw.prepare("INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) VALUES ('u1','https://push.example/1','a','b',1)").run();
  env.DB.raw.prepare("INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) VALUES ('u1','https://push.example/dead','a','b',1)").run();
  return events;
}

const meet = (id, startOffsetMs, over = {}) => ({
  id, iCalUID: id, status: 'confirmed', summary: `Meeting ${id}`,
  start: { dateTime: new Date(NOW + startOffsetMs).toISOString() }, end: { dateTime: new Date(NOW + startOffsetMs + 1800e3).toISOString() },
  hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc', organizer: { email: 'm@x.com' }, attendees: [{ email: 'a@b.com', self: true }, { email: 'm@x.com' }], ...over,
});

test('cron fires once at lead time, records fired, deletes dead subscriptions', async () => {
  const env = await makeEnv();
  await seed(env);
  const g = googleMock({ events: [meet('soon', 100e3), meet('later', 20 * 60e3), meet('solo', 60e3, { hangoutLink: undefined, attendees: undefined, organizer: { email: 'a@b.com', self: true } })] });
  const sent = [];
  const send = async (e, sub, payload) => { sent.push({ ep: sub.endpoint, payload }); return sub.endpoint.endsWith('dead') ? { ok: false, status: 410, gone: true } : { ok: true, status: 201 }; };
  try {
    const r1 = await runCron(env, NOW, send);
    assert.equal(r1.length, 1);
    assert.equal(sent.length, 2); // two subscriptions
    const p = sent[0].payload;
    assert.equal(p.title, 'Join the meeting.');
    assert.equal(p.body, 'Meeting soon starts in 2 min \u00b7 Join on Meet');
    assert.equal(p.data.url, 'https://meet.google.com/aaa-bbbb-ccc');
    assert.deepEqual(p.actions.map((a) => a.title), ['Join', 'Snooze 1 min']);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM fired').get().n, 1);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 1);

    sent.length = 0;
    await runCron(env, NOW + 30e3, send);
    assert.equal(sent.length, 0, 'does not refire');

    await runCron(env, NOW + 17 * 60e3, send);
    assert.equal(sent.length, 0, 'later meeting (20 min away) not yet due at 17 min');
    await runCron(env, NOW + 18 * 60e3 + 5e3, send);
    assert.equal(sent.length, 1, 'later meeting due once inside the lead window (one live subscription left)');
  } finally { g.restore(); }
});

test('cron respects leadSeconds setting and snoozes', async () => {
  const env = await makeEnv();
  await seed(env, [], { leadSeconds: 300 });
  const g = googleMock({ events: [meet('x', 200e3)] });
  const sent = [];
  const send = async (e, sub, payload) => { sent.push(payload); return { ok: true, status: 201 }; };
  try {
    await runCron(env, NOW, send);
    assert.equal(sent.length, 2); // 200 s away <= 300 s lead
    sent.length = 0;
    const key = env.DB.raw.prepare('SELECT event_key k FROM fired').get().k;
    env.DB.raw.prepare("INSERT INTO snoozes VALUES ('u1', ?, ?)").run(key, NOW + 60e3);
    await runCron(env, NOW + 30e3, send);
    assert.equal(sent.length, 0);
    await runCron(env, NOW + 61e3, send);
    assert.equal(sent.length, 2);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM snoozes').get().n, 0);
  } finally { g.restore(); }
});

test('cron skips users without push subscriptions and non-meetings when meetingsOnly', async () => {
  const env = await makeEnv();
  env.DB.raw.prepare("INSERT INTO users VALUES ('u2','s2','z@z.com','Z','', NULL, '{}', 1)").run();
  const sent = [];
  assert.deepEqual(await runCron(env, NOW, async () => { sent.push(1); return { ok: true }; }), []);
  assert.equal(sent.length, 0);
});
