import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { balances, enterExpense, openAs, synced, wake } from './app.ts';

test('a member added, another renamed and the group renamed in one browser reach another, an expense on the new member going through at once', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'members');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Capucine');
  await openAs(page, token, 'Agathe');

  await page.getByRole('link', { name: 'Tu es Agathe' }).click();
  await page.getByRole('link', { name: 'Le groupe', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un membre' }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouveau membre' });
  await sheet.getByRole('textbox', { name: 'Prénom' }).fill('Zoé');
  await sheet.getByRole('button', { name: 'Ajouter au groupe' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('link', { name: 'Zoé', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Basile', exact: true }).click();
  await page.getByRole('button', { name: 'Renommer Basile' }).click();
  await page.getByRole('textbox', { name: 'Prénom' }).fill('Basile B.');
  await page.getByRole('textbox', { name: 'Prénom' }).press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Basile B.' })).toBeVisible();
  await page.getByRole('link', { name: 'Retour au groupe' }).click();
  await page.getByRole('button', { name: 'Renommer le groupe' }).click();
  await page.getByRole('textbox', { name: 'Nom du groupe' }).fill('Vacances');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vacances' })).toBeVisible();

  // At once, before any other read: the phone knows the new member and the server takes the expense.
  await page.getByRole('link', { name: 'Retour aux dépenses' }).click();
  await enterExpense(page, { title: 'Glaces de Zoé', amount: '12,00', between: ['Zoé'] });
  await synced(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const shown = await balances(page);
  expect(shown.get('Zoé')).toBe(-1_200);
  expect(shown.has('Basile B.')).toBe(true);

  await wake(second);
  await expect(second.getByRole('heading', { level: 1, name: 'Vacances' })).toBeVisible();
  await synced(second);
  expect(await balances(second)).toStrictEqual(shown);
  await second.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(second.getByRole('link', { name: /Glaces de Zoé/ })).toBeVisible();
  await other.close();

  // Without network, the edits are greyed and the screen says why.
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Tu es Agathe' }).click();
  await page.getByRole('link', { name: 'Le groupe', exact: true }).click();
  await expect(page.getByText(/^Pas de réseau\. Les changements de prénom/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter un membre' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Renommer le groupe' })).toBeDisabled();
  await context.setOffline(false);
});
