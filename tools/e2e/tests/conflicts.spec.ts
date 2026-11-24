import { expect, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { enterExpense, openAs, synced, wake } from './app.ts';

test('a revision the server refuses leaves the outbox without notice, the others going through (decision 37)', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'refusal');
  await openAs(page, token, 'Agathe');
  await context.setOffline(true);
  await enterExpense(page, { title: 'Glaces acceptées', amount: '6,00', between: ['Agathe', 'Basile'] });
  // Left in the outbox by an older version of the app: it names someone who is not a member, which the app checks today before queuing.
  await page.evaluate(async (link) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(link));
    const name = `la-pince-group-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('open failed'));
      };
    });
    const read = await new Promise<{ group: { members: { id: string }[] } }>((resolve) => {
      const request = db.transaction('meta').objectStore('meta').get('read');
      request.onsuccess = () => {
        resolve(request.result as { group: { members: { id: string }[] } });
      };
    });
    const payer = read.group.members[0]?.id ?? '';
    await new Promise((resolve) => {
      const request = db
        .transaction('outbox', 'readwrite')
        .objectStore('outbox')
        .add({
          id: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          title: 'Glaces refusées',
          date: '2026-11-19',
          entry: { version: 1, kind: 'expense', payer, lines: [{ member: crypto.randomUUID(), amount: 600 }] },
        });
      request.onsuccess = resolve;
    });
    db.close();
  }, token);
  await page.reload();
  await page.getByRole('link', { name: 'Soldes', exact: true }).click();
  await expect(page.getByText(/^Ces soldes comptent 2 saisies non envoyées\./)).toBeVisible();

  // The refusal comes from the real server, in the same batch as the expense it writes.
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith(`/api/groups/${token}/operations`),
  );
  await context.setOffline(false);
  await wake(page);
  const { results } = (await (await answered).json()) as { results: { status: string; reason?: string }[] };
  expect(results.map((result) => [result.status, result.reason])).toStrictEqual([
    ['written', undefined],
    ['rejected', 'unknown_member'],
  ]);
  await synced(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(page.getByRole('link', { name: /Glaces acceptées/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Glaces refusées/ })).toHaveCount(0);

  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(second, token, 'Basile');
  await expect(second.getByRole('link', { name: /Glaces acceptées/ })).toBeVisible();
  await expect(second.getByRole('link', { name: /Glaces refusées/ })).toHaveCount(0);
  await other.close();
});

test('a change made offline overwrites, without notice, one made meanwhile in another browser: the last to reach the server wins (decision 37)', async ({
  page,
  context,
  browser,
}, info) => {
  const token = tokenFor(info.project.name, 'overwrite');
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAs(page, token, 'Agathe');
  await openAs(second, token, 'Basile');
  const rename = async (on: typeof page, title: string) => {
    await on.getByRole('link', { name: 'Dépenses', exact: true }).click();
    await on
      .getByRole('link', { name: /^Kebabs/ })
      .first()
      .click();
    await on.getByRole('link', { name: 'Modifier' }).click();
    await on.getByLabel('Quoi', { exact: true }).fill(title);
    await on.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(on.getByRole('heading', { name: title })).toBeVisible();
  };

  await context.setOffline(true);
  await rename(page, 'Kebabs de Agathe');
  await rename(second, 'Kebabs de Basile');
  await synced(second);
  // Written on the server before Agathe's change arrives, as a third browser reads it.
  const observer = await browser.newContext();
  const observed = await observer.newPage();
  await openAs(observed, token, 'Capucine');
  await expect(observed.getByRole('link', { name: /^Kebabs de Basile/ })).toBeVisible();
  await observer.close();
  await context.setOffline(false);
  await wake(page);
  await synced(page);

  await second.reload();
  await expect(second.getByText('Tu es Basile')).toBeVisible();
  await second.getByRole('link', { name: 'Dépenses', exact: true }).click();
  await expect(second.getByRole('link', { name: /^Kebabs de Agathe/ })).toBeVisible();
  await expect(second.getByRole('link', { name: /^Kebabs de Basile/ })).toHaveCount(0);
  await expect(second.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await other.close();
});
