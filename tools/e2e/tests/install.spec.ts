import { devices, expect, type Page, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl } from './app.ts';

// A phone's Chrome; `beforeinstallprompt` is Chromium's alone.
const phone = devices['Pixel 7'];
test.use({ userAgent: phone.userAgent, viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, isMobile: true, hasTouch: true });
test.skip(({ browserName }) => browserName !== 'chromium', "Chromium's install window");

const token = tokenFor('chromium', 'install');

/**
 * Chrome's install window, faked: a headless browser never hands the real one. Sent at the page's load, it counts the openings and answers
 * « Installer ». A real one, should the browser send it, is stopped before the app sees it.
 */
async function fakeInstallWindow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened = { count: 0 };
    Object.assign(window, { installWindowOpened: opened });
    addEventListener(
      'beforeinstallprompt',
      (event) => {
        if (!('fake' in event)) {
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    addEventListener('load', () => {
      const prompt = () => {
        opened.count += 1;
        return Promise.resolve();
      };
      dispatchEvent(
        Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
          fake: true,
          prompt,
          userChoice: Promise.resolve({ outcome: 'accepted' }),
        }),
      );
    });
  });
}

const openedWindows = (page: Page) =>
  page.evaluate(() => (window as unknown as { installWindowOpened: { count: number } }).installWindowOpened.count);

test('a phone is offered to install once it says who it is, opens the browser window from the guide, and is not offered again', async ({ page }) => {
  await fakeInstallWindow(page);
  await page.goto(`${appUrl()}/g/${token}`);
  await expect(page.getByRole('heading', { name: 'Qui es-tu ?' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agathe', exact: true }).click();

  const offer = page.getByRole('dialog', { name: "Installer l'app ?" });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: "C'est parti" }).click();
  const guide = page.getByRole('dialog', { name: "Installer l'app" });
  await expect(guide.getByRole('heading', { name: 'Touche « Installer » ci-dessous' })).toBeVisible();
  await guide.getByRole('button', { name: 'Installer' }).click();
  await expect(guide.getByRole('heading', { name: "C'est installé : touche l'icône La Pince sur ton écran d'accueil" })).toBeVisible();
  expect(await openedWindows(page)).toBe(1);
  await guide.getByRole('button', { name: "J'ai compris" }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Tu es Agathe')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Tu es Agathe')).toBeVisible();
  // Past the 3 s Chrome is given for its window: still nothing offered.
  await page.waitForTimeout(3500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('« Plus tard » is remembered, on the screen without a group too', async ({ page }) => {
  await fakeInstallWindow(page);
  await page.goto(`${appUrl()}/lien`);
  const offer = page.getByRole('dialog', { name: "Installer l'app ?" });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Plus tard' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ouvre ton groupe' })).toBeVisible();
  await page.goto(`${appUrl()}/g/${token}`);
  await page.getByRole('button', { name: 'Agathe', exact: true }).click();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the guide starts again from my page after « Plus tard », and from the screen without a group', async ({ page }) => {
  await fakeInstallWindow(page);
  await page.goto(`${appUrl()}/g/${token}`);
  await page.getByRole('button', { name: 'Agathe', exact: true }).click();
  await page.getByRole('dialog', { name: "Installer l'app ?" }).getByRole('button', { name: 'Plus tard' }).click();

  await page.getByRole('link', { name: /Tu es Agathe/ }).click();
  await page.getByRole('button', { name: "Installer l'app" }).click();
  const guide = page.getByRole('dialog', { name: "Installer l'app" });
  await guide.getByRole('button', { name: 'Installer' }).click();
  await expect(guide.getByRole('heading', { name: "C'est installé : touche l'icône La Pince sur ton écran d'accueil" })).toBeVisible();
  expect(await openedWindows(page)).toBe(1);
  await guide.getByRole('button', { name: "J'ai compris" }).click();

  await page.goto(`${appUrl()}/lien`);
  await page.getByRole('button', { name: "Installer l'app" }).click();
  await expect(page.getByRole('dialog', { name: "Installer l'app" })).toBeVisible();
});

test.describe('in the browser built into an app', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 356.0.0.41.101 Android (34/14; 420dpi)',
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test('a banner hands the link to open in the browser, the group in reach, and nothing is offered', async ({ page }) => {
    await page.goto(`${appUrl()}/g/${token}`);
    await page.getByRole('button', { name: 'Agathe', exact: true }).click();
    const banner = page.getByRole('complementary', { name: "Installer l'app" });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Copier le lien' }).click();
    await expect(banner.getByText('Colle le lien dans ton navigateur')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${appUrl()}/g/${token}`);

    // The group stays in reach; past the 3 s a browser is given for its window, nothing offered.
    await page.getByRole('link', { name: 'Soldes' }).click();
    await expect(banner).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await banner.getByRole('button', { name: 'Masquer ce message' }).click();
    await expect(banner).toHaveCount(0);
    await page.getByRole('link', { name: 'Dépenses' }).click();
    await expect(page.getByRole('complementary', { name: "Installer l'app" })).toHaveCount(0);
  });
});
