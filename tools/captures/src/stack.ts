import { existsSync } from 'node:fs';
import { join } from 'node:path';

import corpus from '@la-pince/core/fixtures/tricount-demo.json' with { type: 'json' };
import { importTricount } from '@la-pince/import-tricount';
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

export interface Stack {
  readonly demo: Demo;
  readonly close: () => Promise<void>;
}

// Only lives in the in-memory D1 of this run.
const token = 'captures-demo-group-link-token-0123456789';

/**
 * Starts the server and the app of a checkout (the branch, or the version before) on the demo corpus: the Worker in workerd on a fresh local D1,
 * the corpus imported by the import tool, then the app's Vite dev server with its API proxy pointed at that Worker. Undefined when the checkout
 * has no app yet.
 */
export async function startStack(root: string): Promise<Stack | undefined> {
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
