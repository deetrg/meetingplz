// Deletes the throwaway "Apple Development: Created via API" certificates that every CI archive creates
// (the runner loses the private key, so they are useless). Apple caps these at 10; without pruning the archive fails.
// usage: node prune-certs.mjs <AuthKey.p8> <keyId> <issuerId> [--dry]
import crypto from 'node:crypto';
import fs from 'node:fs';
const [,, p8, keyId, issuer, flag] = process.argv;
const pem = fs.readFileSync(p8, 'utf8');
const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b({ alg: 'ES256', kid: keyId, typ: 'JWT' }), p = b({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  return h + '.' + p + '.' + crypto.sign('sha256', Buffer.from(h + '.' + p), { key: pem, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
const call = (m, path) => fetch('https://api.appstoreconnect.apple.com' + path, { method: m, headers: { Authorization: 'Bearer ' + jwt() } });
const list = await (await call('GET', '/v1/certificates?limit=200')).json();
const victims = (list.data || []).filter(c => c.attributes.certificateType === 'DEVELOPMENT' && /Created via API/.test(c.attributes.name || ''));
console.log('development certs created via API:', victims.length);
if (flag !== '--dry') for (const c of victims) { const r = await call('DELETE', '/v1/certificates/' + c.id); console.log('revoke', c.id, r.status); }
