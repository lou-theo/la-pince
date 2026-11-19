import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { computeBalances, computeEffect, convertTricount, suggestTransfers } from '@la-pince/core';
import { expect, test } from '@playwright/test';

import { demoGroup } from '../src/corpus.ts';
import { budgetGroup } from '../src/groups.ts';
import { appUrl, openAs } from './app.ts';

/** Budgets of decision 35 (g), on the corpus repeated 10 times (about 2,500 operations); limits and the CI measures they rest on: decision 38. */
const budgets = {
  balancesMs: 8,
  offlineOpenMs: 550,
  entryVisibleMs: 45,
  catchUpMs: 1_900,
  // Twice the measure would pass the target of the decision: the target itself.
  shellKb: 150,
};

// Measured on one browser: the budgets watch the app, not the engines; the computation of the core runs in the Node of the test runner, V8 as in Chromium.
test.skip(({ browserName }) => browserName !== 'chromium', 'Budgets measured on Chromium only');

function report(name: string, value: number, unit: string, budget: number) {
  test.info().annotations.push({ type: 'mesure', description: `${name} : ${value.toFixed(1)} ${unit} (budget ${String(budget)} ${unit})` });
  // In the CI log, where the bases of the budgets are read.
  process.stdout.write(`MESURE ${name} : ${value.toFixed(1)} ${unit} (budget ${String(budget)} ${unit})\n`);
  expect(value, name).toBeLessThan(budget);
}

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

test('balances and suggested transfers of 2,500 operations', () => {
  const group = convertTricount(demoGroup(budgetGroup.token, budgetGroup.copies));
  expect(group.operations.length).toBeGreaterThan(2_400);
  const runs = Array.from({ length: 21 }, () => {
    const start = performance.now();
    suggestTransfers(computeBalances(group.operations.map((operation) => computeEffect(operation.id, operation.entry))));
    return performance.now() - start;
  });
  report('soldes et remboursements (cœur, Node)', median(runs), 'ms', budgets.balancesMs);
});

test('JS of the shell, compressed', async () => {
  const dist = process.env.E2E_DIST ?? '';
  const assets = join(dist, 'assets');
  const scripts = (await readdir(assets)).filter((file) => file.endsWith('.js'));
  let bytes = 0;
  for (const file of scripts) {
    bytes += gzipSync(await readFile(join(assets, file))).length;
  }
  report('JS de la coquille (gzip)', bytes / 1024, 'Ko', budgets.shellKb);
});

test('catching up from 0, opening offline up to the balances, an entry shown', async ({ page, context }) => {
  // From the link to « who am I », shown once the whole group is read.
  let start = performance.now();
  await page.goto(`${appUrl()}/g/${budgetGroup.token}`);
  await expect(page.getByRole('button', { name: 'Agathe', exact: true })).toBeVisible({ timeout: 20_000 });
  report('rattrapage depuis 0', performance.now() - start, 'ms', budgets.catchUpMs);

  await openAs(page, budgetGroup.token, 'Agathe');
  await page.getByRole('link', { name: 'Soldes', exact: true }).click();
  await context.setOffline(true);
  start = performance.now();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Soldes' }).getByRole('listitem').first()).toBeVisible();
  report('ouverture hors ligne jusqu’aux soldes', performance.now() - start, 'ms', budgets.offlineOpenMs);

  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await page.getByRole('link', { name: 'Ajouter une dépense' }).click();
  await page.getByLabel('Titre').fill('Mesure');
  await page.getByLabel('Montant').fill('12,00');
  // Measured in the page, from the click to the expense on screen, without the round trips of the test driver.
  const shown = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Enregistrer');
        const clicked = performance.now();
        const look = () => {
          if ([...document.querySelectorAll('h1, h2')].some((heading) => heading.textContent === 'Mesure')) {
            resolve(performance.now() - clicked);
          } else {
            requestAnimationFrame(look);
          }
        };
        button?.click();
        look();
      }),
  );
  report('saisie visible', shown, 'ms', budgets.entryVisibleMs);
});
