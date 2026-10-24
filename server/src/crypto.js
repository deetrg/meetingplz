import { b64uDecode, b64uEncode, sha256Hex, utf8, fromUtf8 } from './util.js';

async function aesKey(tokenKey) {
  let raw;
  try { raw = b64uDecode(tokenKey); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) {
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(String(tokenKey))));
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// "v1.<iv>.<ciphertext>" (base64url)
export async function encryptToken(plain, tokenKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(tokenKey), utf8(plain));
  return `v1.${b64uEncode(iv)}.${b64uEncode(ct)}`;
}

export async function decryptToken(blob, tokenKey) {
  const [v, iv, ct] = String(blob).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad_token_blob');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDecode(iv) }, await aesKey(tokenKey), b64uDecode(ct));
  return fromUtf8(pt);
}

export { sha256Hex };
