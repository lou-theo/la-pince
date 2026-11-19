import { changesResponseSchema } from '@la-pince/core';
import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl, balances, enterExpense, openAs, restoreUrl, synced, wake } from './app.ts';

const restoreAction = async (action: 'snapshot' | 'restore') => {
  const response = await fetch(`${restoreUrl()}/${action}`, { method: 'POST' });
  expect(response.status).toBe(204);
};

// The seq the server gave to the expense of that title, read from its API as a phone does.
const seqOf = async (token: string, title: string): Promise<number | undefined> => {
  const response = await fetch(`${appUrl()}/api/groups/${token}/changes`);
  const { changes } = changesResponseSchema.parse(await response.json());
  return changes.find((change) => change.title === title)?.seq;
};

test('after the database is restored behind a phone, the phone drops what the server lost and gets what was written since', async ({
  page,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'restore');
  await openAs(page, token, 'Agathe');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  await restoreAction('snapshot');

  await enterExpense(second, { title: 'Restaurant perdu', amount: '30,00', between: ['Agathe', 'Basile'] });
  await synced(second);
  await wake(page);
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(page.getByText('Restaurant perdu')).toBeVisible();
  const lostSeq = await seqOf(token, 'Restaurant perdu');
  expect(lostSeq).toBeDefined();

  // Back to before the expense; the next revision written takes the seq the expense had, which is the cursor of both browsers.
  await restoreAction('restore');
  await enterExpense(second, { title: 'Courses après restauration', amount: '12,00', between: ['Agathe', 'Basile'] });
  await synced(second);
  expect(await seqOf(token, 'Courses après restauration')).toBe(lostSeq);
  await wake(page);
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(page.getByText('Courses après restauration')).toBeVisible();
  await expect(page.getByText('Restaurant perdu')).toHaveCount(0);
  await second.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(second.getByText('Restaurant perdu')).toHaveCount(0);
  expect(await balances(page)).toStrictEqual(await balances(second));
  await other.close();
});
