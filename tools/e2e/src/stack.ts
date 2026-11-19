import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTricount } from '@la-pince/import-tricount';
import { build } from 'vite';
import { createTestHarness } from 'wrangler';

import { demoGroup } from './corpus.ts';
import { type Database, serveRestore } from './restore.ts';
import { serveApp } from './serve.ts';

/** A demo group to import: its link token, and how many times the corpus is repeated in it. */
export interface GroupSpec {
  readonly token: string;
  readonly copies?: number;
}

export interface Stack {
  readonly appUrl: string;
  /** Folder of the built app, served from disk at each request. */
  readonly dist: string;
  /** Where the tests take a snapshot of the database and restore it (`serveRestore`). */
  readonly restoreUrl: string;
  readonly close: () => Promise<void>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Builds the app as it ships (service worker included, which the dev server leaves out), starts the Worker in workerd on a fresh local D1, imports
 * each demo group by the import tool, then serves the build with `/api` passed to the Worker.
 */
export async function startStack(groups: readonly GroupSpec[]): Promise<Stack> {
  const appRoot = join(root, 'apps/app');
  const dist = await mkdtemp(join(tmpdir(), 'la-pince-e2e-'));
  const adminToken = `e2e-${crypto.randomUUID()}`;
  const server = createTestHarness({ workers: [{ configPath: join(root, 'apps/server/wrangler.jsonc'), secrets: { ADMIN_TOKEN: adminToken } }] });
  let app: Awaited<ReturnType<typeof serveApp>> | undefined;
  let restore: Awaited<ReturnType<typeof serveRestore>> | undefined;
  const close = async () => {
    try {
      await Promise.all([app?.close(), restore?.close()]);
    } finally {
      try {
        await server.close();
      } finally {
        await rm(dist, { recursive: true, force: true });
      }
    }
  };
  try {
    const cwd = process.cwd();
    // The app's Vite plugins read their paths from the working directory.
    process.chdir(appRoot);
    try {
      await build({ configFile: join(appRoot, 'vite.config.ts'), root: appRoot, logLevel: 'warn', build: { outDir: dist, emptyOutDir: true } });
    } finally {
      process.chdir(cwd);
    }
    const serverUrl = (await server.listen()).url.href;
    await server.getWorker().applyD1Migrations('DB');
    for (const group of groups) {
      await importTricount({ data: demoGroup(group.token, group.copies), serverUrl, adminToken, token: group.token });
    }
    restore = await serveRestore((await server.getWorker<{ DB: Database }>().getEnv()).DB);
    app = await serveApp(dist, serverUrl);
    return { appUrl: app.url, dist, restoreUrl: restore.url, close };
  } catch (error) {
    // The error that stopped the start is the one to tell, not one of the cleanup.
    await close().catch(() => undefined);
    throw error;
  }
}
