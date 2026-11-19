import { computeEffect, convertTricount, entrySchema, operationIdSchema } from '@la-pince/core';
import { expect, test } from '@playwright/test';

import { balancesByName, demoGroup } from '../src/corpus.ts';
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
  // The same expense computed by the core outside the app, under the identifier the phone drew for it.
  const id = operationIdSchema.parse(new URL(page.url()).pathname.split('/').at(-1));
  const { members } = convertTricount(demoGroup(token));
  const idOf = (name: string) => members.find((member) => member.name === name)?.id;
  const nameOf = new Map(members.map((member) => [member.id, member.name]));
  const effect = computeEffect(
    id,
    entrySchema.parse({
      version: 1,
      kind: 'expense',
      payer: idOf('Agathe'),
      total: 1_000,
      lines: ['Agathe', 'Basile', 'Capucine'].map((name) => ({ member: idOf(name), weight: 1 })),
    }),
  );
  const expected = new Map(before);
  expected.set('Agathe', (expected.get('Agathe') ?? 0) + effect.total);
  for (const share of effect.shares) {
    const name = nameOf.get(share.member) ?? share.member;
    expected.set(name, (expected.get(name) ?? 0) - share.amount);
  }
  const entered = await balances(page);
  expect(entered).toStrictEqual(expected);
  await expect(page.getByText(/^Ces soldes comptent 1 saisie non envoyée\./)).toBeVisible();
  await context.setOffline(false);
  await wake(page);
  await synced(page);
  expect(await balances(page)).toStrictEqual(entered);

  await second.reload();
  await expect(second.getByText('Tu es Basile')).toBeVisible();
  expect(await balances(second)).toStrictEqual(entered);
  await other.close();
});
