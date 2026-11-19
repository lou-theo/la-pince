import { expect, type Page } from '@playwright/test';

export const appUrl = (): string => {
  const url = process.env.E2E_APP_URL;
  if (url === undefined) {
    throw new Error('E2E_APP_URL is set by the global setup');
  }
  return url;
};

export const restoreUrl = (): string => {
  const url = process.env.E2E_RESTORE_URL;
  if (url === undefined) {
    throw new Error('E2E_RESTORE_URL is set by the global setup');
  }
  return url;
};

/** Opens the group of a link as one of its members, and waits for the service worker to control the page, so that it can reload offline. */
export async function openAs(page: Page, token: string, member: string): Promise<void> {
  await page.goto(`${appUrl()}/g/${token}`);
  await page.getByRole('button', { name: member, exact: true }).click();
  await expect(page.getByText(`Tu es ${member}`)).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Balance of each member as the balances tab shows it, in cents, by name without the « (toi) » mark. */
export async function balances(page: Page): Promise<Map<string, number>> {
  await page.getByRole('link', { name: 'Soldes', exact: true }).click();
  const lines = page.getByRole('region', { name: 'Soldes' }).getByRole('listitem');
  await expect(lines.first()).toBeVisible();
  const read = new Map<string, number>();
  for (const line of await lines.all()) {
    const [name = '', amount = ''] = await line.locator('span').allTextContents();
    read.set(name.replace(' (toi)', ''), cents(amount));
  }
  return read;
}

/** `+1 234,56 €` or `-0,01 €` in cents. */
export function cents(text: string): number {
  const digits = text.replace(/[^\d,-]/g, '');
  const [units = '0', decimals = '00'] = digits.replace('-', '').split(',');
  const value = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  return digits.startsWith('-') ? -value : value;
}

/** Tells the app the network is back, as the browser does on `online`; the tests do not wait for the 30 s wake. */
export async function wake(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

/** Waits until nothing waits to be sent and a sync succeeded, from the line under the balances. */
export async function synced(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Soldes', exact: true }).click();
  await expect(page.getByText(/^Dernière synchro à \d\d:\d\d\.$/)).toBeVisible({ timeout: 20_000 });
}

/** Enters an expense split equally between some members, from the expenses tab. */
export async function enterExpense(
  page: Page,
  expense: { readonly title: string; readonly amount: string; readonly between: readonly string[] },
): Promise<void> {
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await page.getByRole('link', { name: 'Ajouter une dépense' }).click();
  await page.getByLabel('Titre').fill(expense.title);
  await page.getByLabel('Montant').fill(expense.amount);
  await page.getByRole('button', { name: 'Tout décocher' }).click();
  for (const member of expense.between) {
    await page.getByRole('checkbox', { name: new RegExp(`^${member}`) }).check();
  }
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: expense.title })).toBeVisible();
}
