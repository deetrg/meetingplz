import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, vapidHeaders } from '../src/push.js';
import { b64uDecode, b64uEncode } from '../src/util.js';
import { encryptToken, decryptToken } from '../src/crypto.js';
import { makeEnv } from './helpers.js';

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));

test('aes128gcm payload decrypts with the subscriber private key (RFC 8291)', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload({ p256dh: b64uEncode(uaPub), auth: b64uEncode(auth) }, JSON.stringify({ hi: 'there' }));
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  const idlen = body[20];
  assert.equal(idlen, 65);
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const prk = await hkdf(auth, secret, cat(Buffer.from('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  assert.equal(pt[pt.length - 1], 2);
  assert.deepEqual(JSON.parse(Buffer.from(pt.slice(0, -1)).toString()), { hi: 'there' });
});

test('VAPID header carries a valid ES256 JWT for the endpoint origin', async () => {
  const env = await makeEnv();
  const h = await vapidHeaders(env, 'https://fcm.googleapis.com/fcm/send/abc', 1_700_000_000_000);
  const m = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m);
  assert.equal(m[2], env.VAPID_PUBLIC_KEY);
  const [head, body, sig] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, 1_700_000_000 + 43200);
  const pub = await crypto.subtle.importKey('raw', b64uDecode(env.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64uDecode(sig), new TextEncoder().encode(`${head}.${body}`)), true);
});

test('refresh tokens are AES-GCM encrypted and round-trip', async () => {
  const env = await makeEnv();
  const blob = await encryptToken('1//refresh', env.TOKEN_KEY);
  assert.ok(blob.startsWith('v1.'));
  assert.ok(!blob.includes('refresh'));
  assert.equal(await decryptToken(blob, env.TOKEN_KEY), '1//refresh');
  await assert.rejects(decryptToken(blob, 'other-key'));
});
