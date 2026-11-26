import { existsSync } from 'node:fs';
import { join } from 'node:path';

import corpus from '@la-pince/core/fixtures/tricount-demo.json' with { type: 'json' };
import { importTricount } from '@la-pince/import-tricount';
import type { Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { createTestHarness } from 'wrangler';

import type { Demo } from './screens.ts';

const base64Url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url');

/** A VAPID key pair as the Worker's secrets take it (`apps/server/src/vapid.ts`), so that the screens show the notifications as an instance that offers them. */
async function vapidKeys(): Promise<{ VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { d = '' } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { VAPID_PUBLIC_KEY: base64Url(await crypto.subtle.exportKey('raw', pair.publicKey)), VAPID_PRIVATE_KEY: d };
}

// Drawn faces, never a photo of a person (decision « Édition du groupe et avatar », point o): background, shirt, skin and hair.
const looks = [
  ['#f9dde6', '#be185d', '#f4cfb0', '#b5562a'],
  ['#dbeafe', '#1d4ed8', '#e8b98f', '#3f2a1d'],
  ['#dcfce7', '#15803d', '#c68a5e', '#1c1917'],
  ['#fef3c7', '#b45309', '#f1d3b3', '#d6a54a'],
  ['#ede9fe', '#6d28d9', '#8d5a3b', '#2b1b14'],
] as const;
// Who gets a photo, by their place in the group: the first, whom the screens choose as who I am, and the second, whose sheet they open from the
// group; the others between keep their initial, which the screens show beside the photos.
const withPhoto = [0, 1, 3, 5, 7];

/** Sets drawn photos on some members of the demo group, as the app sends them: a JPEG of 256 px, drawn and encoded by the browser. */
async function setPhotos(browser: Browser, serverUrl: string): Promise<void> {
  const group = (await (await fetch(new URL(`api/groups/${token}`, serverUrl))).json()) as { members: { id: string }[] };
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  try {
    for (const [index, [background, shirt, skin, hair]] of looks.entries()) {
      const member = group.members[withPhoto[index] ?? -1];
      if (member === undefined) {
        continue;
      }
      await page.setContent(
        `<body style="margin:0"><svg width="256" height="256" viewBox="0 0 40 40"><rect width="40" height="40" fill="${background}"/>` +
          `<path d="M5 42c1-10 7-14 15-14s14 4 15 14z" fill="${shirt}"/><circle cx="20" cy="18" r="8" fill="${skin}"/>` +
          `<path d="M11.5 17c-.5-7 3.5-10.5 8.5-10.5s9 3.5 8.5 10.5c-1.5-3.5-4.5-5-8.5-5s-7 1.5-8.5 5z" fill="${hair}"/></svg></body>`,
      );
      // An instance without photos refuses it: the screens then show initials only.
      await fetch(new URL(`api/groups/${token}/members/${member.id}/photo`, serverUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: await page.screenshot({ type: 'jpeg', quality: 85 }),
      });
    }
  } finally {
    await page.close();
  }
}

export interface Stack {
  readonly demo: Demo;
  readonly close: () => Promise<void>;
}

// Only lives in the in-memory D1 of this run.
const token = 'captures-demo-group-link-token-0123456789';

/**
 * Starts the server and the app of a checkout (the branch, or the version before) on the demo corpus: the Worker in workerd on a fresh local D1,
 * the corpus imported by the import tool with drawn photos on some members, then the app's Vite dev server with its API proxy pointed at that
 * Worker. Undefined when the checkout has no app yet.
 */
export async function startStack(root: string, browser: Browser): Promise<Stack | undefined> {
  const appRoot = join(root, 'apps/app');
  if (!existsSync(join(appRoot, 'vite.config.ts'))) {
    return undefined;
  }
  const adminToken = `captures-${crypto.randomUUID()}`;
  const server = createTestHarness({
    workers: [{ configPath: join(root, 'apps/server/wrangler.jsonc'), secrets: { ADMIN_TOKEN: adminToken, ...(await vapidKeys()) } }],
  });
  const cwd = process.cwd();
  let vite: ViteDevServer | undefined;
  // Each step runs even if the one before fails, so that no server outlives the run.
  const close = async () => {
    try {
      await vite?.close();
    } finally {
      try {
        await server.close();
      } finally {
        process.chdir(cwd);
      }
    }
  };
  try {
    const serverUrl = (await server.listen()).url.href;
    await server.getWorker().applyD1Migrations('DB');
    await importTricount({ data: corpus, serverUrl, adminToken, token });
    await setPhotos(browser, serverUrl);
    // The app's Vite plugins read their paths from the working directory, until the stack closes.
    process.chdir(appRoot);
    vite = await createServer({
      configFile: join(appRoot, 'vite.config.ts'),
      root: appRoot,
      logLevel: 'warn',
      server: { port: 0, proxy: { '/api': serverUrl } },
    });
    await vite.listen();
    const appUrl = vite.resolvedUrls?.local[0]?.replace(/\/$/, '');
    if (appUrl === undefined) {
      throw new Error('Vite did not say where it listens');
    }
    return { demo: { appUrl, token }, close };
  } catch (error) {
    await close();
    throw error;
  }
}
