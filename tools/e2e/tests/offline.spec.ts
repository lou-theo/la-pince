import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { balances, enterExpense, openAs, synced, wake } from './app.ts';

test('an expense entered offline, after a restart without network, reaches another browser with balances equal to the cent', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'offline');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  const before = await balances(second);

  await openAs(page, token, 'Agathe');
  await context.setOffline(true);
  // The app starts again without network: the shell from the service worker, the group from the copy on the phone.
  await page.reload();
  await expect(page.getByText('Tu es Agathe')).toBeVisible();
  await enterExpense(page, { title: 'Pizzas du soir', amount: '31,50', between: ['Agathe', 'Basile', 'Capucine'] });
  await expect(page.getByText("En attente d'envoi")).toBeVisible();
  // Agathe paid 31,50 € shared by three: 10,50 € each.
  const expected = new Map(before);
  const shift = (name: string, by: number) => expected.set(name, (expected.get(name) ?? 0) + by);
  shift('Agathe', 2_100);
  shift('Basile', -1_050);
  shift('Capucine', -1_050);
  expect(await balances(page)).toStrictEqual(expected);
  await expect(page.getByText(/^Ces soldes comptent 1 saisie non envoyée\./)).toBeVisible();

  await context.setOffline(false);
  await wake(page);
  await synced(page);
  expect(await balances(page)).toStrictEqual(expected);

  await second.reload();
  await expect(second.getByText('Tu es Basile')).toBeVisible();
  expect(await balances(second)).toStrictEqual(expected);
  await other.close();
});
