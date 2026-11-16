import { buildPushPayload } from '@block65/webcrypto-web-push';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
const v = JSON.parse(fs.readFileSync('vapid.json', 'utf8'));
// Abonnement factice mais valide : clé P-256 et secret générés ici.
const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: { p256dh: raw, auth: Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64url') } };
const vapid = { subject: 'mailto:essai@example.com', publicKey: v.publicKey, privateKey: v.privateKey };
for (let i = 0; i < 5; i++) await buildPushPayload({ data: 'x', options: { ttl: 60 } }, sub, vapid);
const n = 50, t0 = process.cpuUsage();
for (let i = 0; i < n; i++) await buildPushPayload({ data: 'Max a ajouté « Pizza »', options: { ttl: 3600 } }, sub, vapid);
const u = process.cpuUsage(t0);
console.log('CPU moyen par notification (ms):', ((u.user + u.system) / 1000 / n).toFixed(2));
