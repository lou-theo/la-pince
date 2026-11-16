// Essai : Worker Hono + D1 qui enregistre l'abonnement push d'un membre et notifie les seuls membres concernés par une dépense.
import { Hono } from 'hono';
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';

type Env = { DB: D1Database; VAPID_PUBLIC: string; VAPID_PRIVATE: string };
const app = new Hono<{ Bindings: Env }>();

const page = (pub: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="manifest" href="/manifest.json"><title>Essai Cloudflare</title></head>
<body style="font:20px system-ui;padding:24px"><h1>Essai Cloudflare</h1>
<p>Qui suis-je ?</p><select id="m" style="font-size:22px"><option>Léa</option><option>Max</option><option>Tom</option></select>
<p><button id="b" style="font-size:22px;padding:12px">Activer les notifications</button></p><pre id="log"></pre>
<script>
const log = m => { document.getElementById('log').textContent += m + '\\n'; };
navigator.serviceWorker.register('/sw.js');
document.getElementById('b').onclick = async () => {
  try {
    log('permission ' + await Notification.requestPermission());
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: '${pub}' });
    const r = await fetch('/subscribe', { method: 'POST', body: JSON.stringify({ member: document.getElementById('m').value, sub }) });
    log('abonné comme ' + document.getElementById('m').value + ' : ' + r.status);
  } catch (e) { log('erreur ' + e); }
};
</script></body></html>`;

app.get('/', (c) => c.html(page(c.env.VAPID_PUBLIC)));
app.get('/manifest.json', (c) => c.json({ name: 'Essai Cloudflare', short_name: 'Essai', start_url: '/', display: 'standalone', icons: [] }));
app.get('/sw.js', (c) => c.body(`self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('Nouvelle dépense', { body: e.data ? e.data.text() : '' })));`, 200, { 'Content-Type': 'text/javascript' }));

app.post('/subscribe', async (c) => {
  const { member, sub } = await c.req.json<{ member: string; sub: PushSubscription }>();
  await c.env.DB.prepare('INSERT OR REPLACE INTO sub (member, endpoint, json) VALUES (?, ?, ?)').bind(member, sub.endpoint, JSON.stringify(sub)).run();
  return c.body(null, 201);
});

// Simule l'ajout d'une dépense : notifie les concernés sauf l'auteur.
app.post('/expense', async (c) => {
  const { author, title, concerned } = await c.req.json<{ author: string; title: string; concerned: string[] }>();
  const targets = concerned.filter((m) => m !== author);
  const rows = targets.length
    ? (await c.env.DB.prepare(`SELECT member, json FROM sub WHERE member IN (${targets.map(() => '?').join(',')})`).bind(...targets).all<{ member: string; json: string }>()).results
    : [];
  const vapid = { subject: 'mailto:essai@example.com', publicKey: c.env.VAPID_PUBLIC, privateKey: c.env.VAPID_PRIVATE };
  const sent = await Promise.all(rows.map(async (r) => {
    const sub = JSON.parse(r.json) as PushSubscription;
    const payload = await buildPushPayload({ data: `${author} a ajouté « ${title} »`, options: { ttl: 3600 } }, sub, vapid);
    const res = await fetch(sub.endpoint, payload);
    return { member: r.member, status: res.status };
  }));
  return c.json({ targets, sent });
});

export default app;
