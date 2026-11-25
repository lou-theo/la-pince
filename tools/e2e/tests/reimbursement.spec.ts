import { expect, type Page, test } from '@playwright/test';

import { balancesByName, demoGroup } from '../src/corpus.ts';
import { tokenFor } from '../src/groups.ts';
import { balances, cents, openAs, synced, wake, withoutMark } from './app.ts';

/** Opens the suggested transfers from the balances tab. */
async function openTransfers(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Soldes', exact: true }).click();
  await page.getByRole('link', { name: /^Pour tout solder/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Remboursements suggérés' })).toBeVisible();
}

/** The first “C'est payé” of the screen, and the transfer it records, read from its name (« C'est payé : Capucine doit 23,18 € à Basile »). */
async function firstTransfer(page: Page) {
  const button = page.getByRole('button', { name: /^C'est payé : / }).first();
  const label = (await button.getAttribute('aria-label')) ?? '';
  const match = /^C'est payé : (.+) doit (.+) à (.+)$/.exec(label);
  if (match === null) {
    throw new Error(`not a suggested transfer: ${label}`);
  }
  const [, from = '', amount = '', to = ''] = match;
  // Named as in the balances, the member who I am included.
  return { button, from: withoutMark(from), to: withoutMark(to), amount: cents(amount) };
}

/** The balances once a reimbursement of `amount` from `from` to `to` is counted: the giver is owed it back, the receiver owes it. */
function afterReimbursement(before: ReadonlyMap<string, number>, from: string, to: string, amount: number): Map<string, number> {
  const after = new Map(before);
  after.set(from, (after.get(from) ?? 0) + amount);
  after.set(to, (after.get(to) ?? 0) - amount);
  return after;
}

/** Another browser, as Basile, that reads the group again until its balances are `expected`. */
async function seenElsewhere(page: Page, expected: ReadonlyMap<string, number>): Promise<void> {
  await page.reload();
  await expect(page.getByText('Tu es Basile')).toBeVisible();
  await expect.poll(() => balances(page)).toStrictEqual(expected);
}

test("“C'est payé” offline records the transfer at once, then reaches another browser with balances equal to the cent", async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'settle');
  const before = balancesByName(demoGroup(token));
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  await openAs(page, token, 'Agathe');
  expect(await balances(page)).toStrictEqual(before);

  await context.setOffline(true);
  await openTransfers(page);
  const { button, from, to, amount } = await firstTransfer(page);
  await button.click();
  await expect(page.getByRole('status')).toContainText('Remboursement enregistré');
  await expect(page.getByRole('listitem', { name: /^Payé : / })).toBeVisible();
  const expected = afterReimbursement(before, from, to, amount);
  expect(await balances(page)).toStrictEqual(expected);
  await expect(page.getByText(/^Ces soldes comptent 1 saisie non envoyée\./)).toBeVisible();

  await context.setOffline(false);
  await wake(page);
  await synced(page);
  expect(await balances(page)).toStrictEqual(expected);
  await seenElsewhere(second, expected);
  await other.close();
});

test('“Annuler” takes back a payment already sent: the balances come back to the cent, here and in another browser', async ({
  page,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'undo');
  const before = balancesByName(demoGroup(token));
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  await openAs(page, token, 'Agathe');

  await openTransfers(page);
  const { button, from, to, amount } = await firstTransfer(page);
  await button.click();
  // Sent before it is undone, so that the other browser sees it come and go.
  await expect(page.getByText(/^Dernière synchro à \d\d:\d\d\.$/)).toBeVisible({ timeout: 20_000 });
  await seenElsewhere(second, afterReimbursement(before, from, to, amount));
  await page.getByRole('button', { name: 'Annuler ce remboursement' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('listitem', { name: /^Payé : / })).toHaveCount(0);
  await synced(page);
  expect(await balances(page)).toStrictEqual(before);
  await seenElsewhere(second, before);
  await other.close();
});

test('the free page records a reimbursement between the two members chosen', async ({ page }, info) => {
  const token = tokenFor(info.project.name, 'declare');
  const before = balancesByName(demoGroup(token));
  await openAs(page, token, 'Agathe');
  await openTransfers(page);
  await page.getByRole('link', { name: 'Déclarer un autre remboursement' }).click();
  // Given by who I am; who receives it is chosen in the grid.
  await expect(page.getByRole('button', { name: 'De : Agathe (toi)' })).toBeVisible();
  await page.getByRole('heading', { name: 'À qui' }).waitFor();
  await page.getByRole('button', { name: 'Basile', exact: true }).click();
  await page.getByLabel('Montant', { exact: true }).fill('5,25');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Agathe (toi) a remboursé Basile')).toBeVisible();
  await synced(page);
  expect(await balances(page)).toStrictEqual(afterReimbursement(before, 'Agathe', 'Basile', 525));
});
