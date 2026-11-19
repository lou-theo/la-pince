import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { balances, enterExpense, openAs, synced, wake } from './app.ts';

const restoreAction = async (action: 'snapshot' | 'restore') => {
  const url = process.env.E2E_RESTORE_URL;
  if (url === undefined) {
    throw new Error('E2E_RESTORE_URL is set by the global setup');
  }
  const response = await fetch(`${url}/${action}`, { method: 'POST' });
  expect(response.status).toBe(204);
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

  // Back to before the expense; the next revision written takes the seq the expense had, which is the cursor of both browsers.
  await restoreAction('restore');
  await enterExpense(second, { title: 'Courses après restauration', amount: '12,00', between: ['Agathe', 'Basile'] });
  await synced(second);
  await wake(page);
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(page.getByText('Courses après restauration')).toBeVisible();
  await expect(page.getByText('Restaurant perdu')).toHaveCount(0);
  await second.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(second.getByText('Restaurant perdu')).toHaveCount(0);
  expect(await balances(page)).toStrictEqual(await balances(second));
  await other.close();
});
