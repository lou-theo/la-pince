import { convertTricount } from '@la-pince/core';
import { expect, test } from '@playwright/test';

import { demoGroup } from '../src/corpus.ts';
import { tokenFor } from '../src/groups.ts';
import { appUrl, openAs } from './app.ts';

const memberId = (token: string, name: string) => convertTricount(demoGroup(token)).members.find((member) => member.name === name)?.id;

// The push service of a headless browser cannot be reached: the subscription is the one a phone would give, and the push arrives through the
// DevTools protocol, unencrypted, as the browser hands it to the service worker once decrypted (project `chromium-notifications`).
test('a phone subscribes as who it is, and a push about an expense shows a notification titled with the group', async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: appUrl() });
  await page.addInitScript(() => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-phone';
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) } }),
      unsubscribe: () => Promise.resolve(true),
    };
    let current: typeof subscription | null = null;
    PushManager.prototype.subscribe = () => Promise.resolve((current = subscription) as unknown as PushSubscription);
    PushManager.prototype.getSubscription = () => Promise.resolve(current as unknown as PushSubscription | null);
  });
  const token = tokenFor('chromium', 'notifications');
  await openAs(page, token, 'Agathe');
  const title = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';

  const subscribed = page.waitForResponse(`${appUrl()}/api/groups/${token}/subscription`);
  await page.getByRole('button', { name: 'Activer les notifications' }).click();
  const response = await subscribed;
  // Sent as who the phone is: Agathe's id in the group, drawn by the corpus.
  expect((response.request().postDataJSON() as { member: string }).member).toBe(memberId(token, 'Agathe'));
  const { groupId } = (await response.json()) as { groupId: string };
  await expect(page.getByText('Notifications activées sur cet appareil.')).toBeVisible();

  const cdp = await context.newCDPSession(page);
  const registrations = new Promise<string>((resolve) => {
    cdp.on(
      'ServiceWorker.workerRegistrationUpdated',
      ({ registrations: updated }: { registrations: { registrationId: string; isDeleted: boolean }[] }) => {
        const live = updated.find((registration) => !registration.isDeleted);
        if (live !== undefined) {
          resolve(live.registrationId);
        }
      },
    );
  });
  await cdp.send('ServiceWorker.enable');
  const message = {
    type: 'operations',
    groupId,
    count: 1,
    notices: [{ kind: 'added', operationId: 'e2e-pizza', title: 'Pizza', author: 'someone', authorName: 'Basile' }],
  };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: appUrl(), registrationId: await registrations, data: JSON.stringify(message) });

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return (await registration?.getNotifications())?.map((shown) => ({ title: shown.title, body: shown.body, data: shown.data as unknown }));
      }),
    )
    .toStrictEqual([{ title, body: 'Basile a ajouté « Pizza »', data: { path: `/g/${token}/operations/e2e-pizza` } }]);
});
