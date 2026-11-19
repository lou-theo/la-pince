import { expect, test } from '@playwright/test';

import { balancesByName, demoGroup } from '../src/corpus.ts';
import { tokenFor } from '../src/groups.ts';
import { balances, enterExpense, openAs, synced, wake } from './app.ts';

const shift = (after: ReadonlyMap<string, number>, before: ReadonlyMap<string, number>, name: string) =>
  (after.get(name) ?? 0) - (before.get(name) ?? 0);

test('an expense entered offline, after a restart without network, reaches another browser with balances equal to the cent', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'offline');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  // The balances shown match the core's computation outside the app, before anything is entered.
  const before = balancesByName(demoGroup(token));
  expect(await balances(second)).toStrictEqual(before);

  await openAs(page, token, 'Agathe');
  await context.setOffline(true);
  // The app starts again without network: the shell from the service worker, the group from the copy on the phone.
  await page.reload();
  await expect(page.getByText('Tu es Agathe')).toBeVisible();
  // 10,00 € by three leaves a cent over, given by the rule of the core: every phone must give it to the same member.
  await enterExpense(page, { title: 'Pizzas du soir', amount: '10,00', between: ['Agathe', 'Basile', 'Capucine'] });
  await expect(page.getByText("En attente d'envoi")).toBeVisible();
  const entered = await balances(page);
  await expect(page.getByText(/^Ces soldes comptent 1 saisie non envoyée\./)).toBeVisible();
  const shares = ['Agathe', 'Basile', 'Capucine'].map((name) => -shift(entered, before, name) + (name === 'Agathe' ? 1_000 : 0));
  expect([...shares].sort((a, b) => a - b)).toStrictEqual([333, 333, 334]);
  for (const name of before.keys()) {
    if (!['Agathe', 'Basile', 'Capucine'].includes(name)) {
      expect(shift(entered, before, name), name).toBe(0);
    }
  }

  await context.setOffline(false);
  await wake(page);
  await synced(page);
  expect(await balances(page)).toStrictEqual(entered);

  await second.reload();
  await expect(second.getByText('Tu es Basile')).toBeVisible();
  expect(await balances(second)).toStrictEqual(entered);
  await other.close();
});
