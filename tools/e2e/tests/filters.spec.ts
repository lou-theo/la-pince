import { computeEffect, convertTricount } from '@la-pince/core';
import corpus from '@la-pince/core/fixtures/tricount-demo.json' with { type: 'json' };
import { expect, type Page, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl, cents, openAs } from './app.ts';

/**
 * What the list should keep as Agathe, computed by the core outside the app: the lines, and the expenses among them with their total and her share.
 * `paidBy` names the payer, `atLeast` bounds the total in cents.
 */
function expected(filter: { readonly paidBy?: string; readonly atLeast?: number }) {
  const group = convertTricount(corpus);
  const idOf = (name: string) => group.members.find((member) => member.name === name)?.id;
  const me = idOf('Agathe');
  const payer = filter.paidBy === undefined ? undefined : idOf(filter.paidBy);
  const kept = group.operations
    .map((operation) => ({ kind: operation.entry.kind, effect: computeEffect(operation.id, operation.entry) }))
    .filter(({ effect }) => effect.shares.some((share) => share.member === me && share.amount > 0))
    .filter(({ effect }) => payer === undefined || effect.payer === payer)
    .filter(({ effect }) => effect.total >= (filter.atLeast ?? 0));
  const expenses = kept.filter(({ kind }) => kind === 'expense');
  return {
    lines: kept.length,
    expenses: expenses.length,
    total: expenses.reduce((sum, { effect }) => sum + effect.total, 0),
    myShare: expenses.reduce((sum, { effect }) => sum + (effect.shares.find((share) => share.member === me)?.amount ?? 0), 0),
  };
}

/** The heading over a filtered list, read back in cents (« 12 dépenses · 342,77 € au total · ta part 114,24 € »). */
async function heading(page: Page) {
  const text = (await page.getByText(/ au total · ta part /).textContent()) ?? '';
  const match = /^(\d+) dépenses? · (.+) au total · ta part (.+)$/.exec(text);
  if (match === null) {
    throw new Error(`not the heading of a filtered list: ${text}`);
  }
  const [, count = '', total = '', share = ''] = match;
  return { expenses: Number(count), total: cents(total), myShare: cents(share) };
}

const lines = (page: Page) => page.getByRole('main').locator('a[href*="/operations/"]');

test('the filters narrow the demo group to the cent, from the pills then the sheet, and stay while an expense is open', async ({ page }, info) => {
  const token = tokenFor(info.project.name, 'filters');
  await openAs(page, token, 'Agathe');

  await page.getByRole('button', { name: 'Me concerne' }).click();
  const mine = expected({});
  await expect(lines(page)).toHaveCount(mine.lines);
  expect(await heading(page)).toStrictEqual({ expenses: mine.expenses, total: mine.total, myShare: mine.myShare });

  await page.getByRole('button', { name: 'Filtres' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filtres' });
  await sheet.getByRole('button', { name: 'Ajouter un payeur' }).click();
  const grid = page.getByRole('dialog', { name: 'Payé par' });
  await grid.getByRole('button', { name: 'Basile', exact: true }).click();
  await grid.getByRole('button', { name: 'Valider · 1 personne' }).click();
  await sheet.getByRole('textbox', { name: 'Montant au moins' }).fill('20');
  const narrowed = expected({ paidBy: 'Basile', atLeast: 2_000 });
  await sheet.getByRole('button', { name: new RegExp(`^Voir ${String(narrowed.lines)} dépenses?$`) }).click();
  await expect(sheet).toBeHidden();
  await expect(lines(page)).toHaveCount(narrowed.lines);
  expect(await heading(page)).toStrictEqual({ expenses: narrowed.expenses, total: narrowed.total, myShare: narrowed.myShare });

  // Kept while an expense is open, and back on the list.
  await lines(page).first().click();
  await expect(page).toHaveURL(new RegExp(`${appUrl()}/g/${token}/operations/`));
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(lines(page)).toHaveCount(narrowed.lines);
  await expect(page.getByRole('button', { name: 'Modifier les filtres : Me concerne, De Basile, ≥ 20,00 €' })).toBeVisible();

  await page.getByRole('button', { name: 'Retirer les filtres' }).click();
  await expect(page.getByText(/ au total · ta part /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Me concerne' })).toHaveAttribute('aria-pressed', 'false');
  expect(await lines(page).count()).toBeGreaterThan(narrowed.lines);
});
