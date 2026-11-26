import { devices, expect, type Page, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl } from './app.ts';

// User agents of Android browsers other than Chrome, played by Chromium: Firefox installs from its own menu, Samsung Internet hands no install
// window to the app and is taken for a browser that cannot install.
const firefox = 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0';
const samsung =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';

const phone = devices['Pixel 7'];
test.use({ viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, isMobile: true, hasTouch: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'Android browsers, played by Chromium');

const token = tokenFor('chromium', 'install');
const cannot = "Ce navigateur ne sait pas installer l'app";

/**
 * Keeps any real install window of Chromium from the app, as Samsung Internet would hand none, and puts a clipboard on the page that keeps what
 * it is given in `copied`.
 */
async function asOtherAndroid(page: Page): Promise<void> {
  await page.addInitScript(() => {
    addEventListener(
      'beforeinstallprompt',
      (event) => {
        event.stopImmediatePropagation();
      },
      { capture: true },
    );
    const copied: string[] = [];
    Object.assign(window, { copied });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

/** Goes through the guide by « Suivant » from its current step, each instruction checked, then closes it by « J'ai compris ». */
async function walk(page: Page, instructions: readonly string[]): Promise<void> {
  const guide = page.getByRole('dialog', { name: "Installer l'app" });
  for (const [index, instruction] of instructions.entries()) {
    await expect(guide.getByRole('heading', { level: 3 })).toHaveText(instruction);
    await guide.getByRole('button', { name: index === instructions.length - 1 ? "J'ai compris" : 'Suivant' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Firefox', () => {
  test.use({ userAgent: firefox });

  test("is walked through its ⋮ menu and « Plus » to the window of Android's home screen, once it says who it is", async ({ page }) => {
    await asOtherAndroid(page);
    await page.goto(`${appUrl()}/g/${token}`);
    await page.getByRole('button', { name: 'Agathe', exact: true }).click();
    await page.getByRole('dialog', { name: "Installer l'app ?" }).getByRole('button', { name: "C'est parti" }).click();
    await expect(page.getByText('Étape 1 sur 5')).toBeVisible();
    await walk(page, [
      'Touche ⋮ en haut à droite',
      'Touche « Plus »',
      "Touche « Ajouter l'application à l'écran d'accueil »",
      "Touche « Ajouter » dans la fenêtre qui s'ouvre",
      "Touche l'icône La Pince sur ton écran d'accueil",
    ]);
    await expect(page.getByText('Tu es Agathe')).toBeVisible();
  });
});

test.describe('Samsung Internet', () => {
  test.use({ userAgent: samsung });

  test('is told it cannot install, offered Chrome and the link to copy, and still walked through a shortcut', async ({ page }) => {
    await asOtherAndroid(page);
    await page.goto(`${appUrl()}/lien`);
    // Given 3 s to hand its install window, then taken for a browser that cannot install.
    const offer = page.getByRole('dialog', { name: "Installer l'app ?" });
    await expect(offer).toBeVisible({ timeout: 6000 });
    await offer.getByRole('button', { name: "C'est parti" }).click();
    const guide = page.getByRole('dialog', { name: "Installer l'app" });
    await expect(guide.getByRole('heading', { level: 3 })).toHaveText(cannot);
    await expect(guide.getByRole('link', { name: 'Ouvrir dans Chrome' })).toHaveAttribute(
      'href',
      `intent://${new URL(appUrl()).host}/lien#Intent;scheme=http;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(`${appUrl()}/lien`)};end`,
    );

    await guide.getByRole('button', { name: 'Copier le lien' }).click();
    await expect(guide.getByRole('button', { name: 'Lien copié : colle-le dans Chrome' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([`${appUrl()}/lien`]);

    await guide.getByRole('button', { name: 'Faire un raccourci quand même' }).click();
    await expect(guide.getByRole('heading', { name: 'Faire un raccourci' })).toBeVisible();
    await expect(guide.getByText('Étape 1 sur 3')).toBeVisible();
    await walk(page, ['Touche ⋮ en haut à droite', "Touche « Ajouter à l'écran d'accueil »", 'Touche « Ajouter »']);
    await expect(page.getByRole('heading', { name: 'Ouvre ton groupe' })).toBeVisible();
  });
});
