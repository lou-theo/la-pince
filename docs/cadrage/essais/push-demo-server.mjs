// Démo Web Push : sert une PWA minimale, stocke l'abonnement, envoie une notification sur GET /send.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const dir = path.dirname(new URL(import.meta.url).pathname);
const vapid = JSON.parse(fs.readFileSync(path.join(dir, 'vapid.json'), 'utf8'));
webpush.setVapidDetails('mailto:demo@example.com', vapid.publicKey, vapid.privateKey);
const subFile = path.join(dir, 'subscription.json');

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="manifest" href="/manifest.json"><meta name="apple-mobile-web-app-capable" content="yes"><title>Push démo</title></head>
<body style="font:20px system-ui;padding:24px"><h1>Push démo</h1>
<p id="etat">standalone: <span id="sa"></span><br>Notification: <span id="perm"></span><br>PushManager: <span id="pm"></span></p>
<button id="b" style="font-size:24px;padding:16px">Activer les notifications</button><pre id="log"></pre>
<script>
const log = m => { document.getElementById('log').textContent += m + '\\n'; fetch('/log', {method:'POST', body: m}); };
document.getElementById('sa').textContent = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
document.getElementById('perm').textContent = typeof Notification === 'undefined' ? 'absent' : Notification.permission;
document.getElementById('pm').textContent = 'PushManager' in window;
log('chargée, standalone=' + document.getElementById('sa').textContent + ', PushManager=' + ('PushManager' in window));
navigator.serviceWorker.register('/sw.js').then(() => log('sw enregistré')).catch(e => log('sw erreur ' + e));
document.getElementById('b').onclick = async () => {
  try {
    const p = await Notification.requestPermission(); log('permission ' + p);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: '${vapid.publicKey}' });
    await fetch('/subscribe', { method: 'POST', body: JSON.stringify(sub) }); log('abonné ' + sub.endpoint.slice(0, 40));
  } catch (e) { log('erreur ' + e); }
};
</script></body></html>`;
const manifest = JSON.stringify({ name: 'Push démo', short_name: 'Push', start_url: '/', display: 'standalone', icons: [] });
const sw = `self.addEventListener('push', e => { const d = e.data ? e.data.text() : 'vide';
  e.waitUntil(self.registration.showNotification('Nouvelle dépense', { body: d })); });`;

http.createServer(async (req, res) => {
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page); }
  if (req.url === '/manifest.json') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return res.end(manifest); }
  if (req.url === '/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(sw); }
  if (req.url === '/log') { console.log('[page]', body); res.writeHead(204); return res.end(); }
  if (req.url === '/subscribe') { fs.writeFileSync(subFile, body); console.log('[abonnement]', JSON.parse(body).endpoint); res.writeHead(201); return res.end(); }
  if (req.url === '/send') {
    try {
      const r = await webpush.sendNotification(JSON.parse(fs.readFileSync(subFile, 'utf8')), 'Max a ajouté « Pizza » : ta part 12,50 €');
      console.log('[envoi]', r.statusCode); res.writeHead(200); return res.end('envoyé ' + r.statusCode);
    } catch (e) { console.log('[envoi erreur]', e.statusCode, e.body); res.writeHead(500); return res.end(String(e.body || e)); }
  }
  res.writeHead(404); res.end();
}).listen(8787, '127.0.0.1', () => console.log('prêt sur http://localhost:8787'));
