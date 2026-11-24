import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { openAs } from './app.ts';

test('a new version of the app installs without reloading the page while an expense is being entered (decision 35 e)', async ({ page }, info) => {
  const dist = process.env.E2E_DIST;
  if (dist === undefined) {
    throw new Error('E2E_DIST is set by the global setup');
  }
  await openAs(page, tokenFor(info.project.name, 'update'), 'Agathe');
  await page.getByRole('link', { name: 'Ajouter une dépense' }).click();
  await page.getByLabel('Quoi', { exact: true }).fill('Saisie en cours');
  // Lost if the page reloads.
  await page.evaluate(() => {
    Object.assign(window, { e2eSamePage: true, e2eControllerChanged: false });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      Object.assign(window, { e2eControllerChanged: true });
    });
  });

  // A new deployment: the service worker changes, as with any new build.
  await appendFile(join(dist, 'sw.js'), `\n// e2e deployment for ${info.project.name}\n`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await page.waitForFunction(() => 'e2eControllerChanged' in window && window.e2eControllerChanged === true);

  expect(await page.evaluate(() => 'e2eSamePage' in window)).toBe(true);
  await expect(page.getByLabel('Quoi', { exact: true })).toHaveValue('Saisie en cours');
  await expect(page.getByRole('heading', { name: 'Nouvelle dépense' })).toBeVisible();
});
