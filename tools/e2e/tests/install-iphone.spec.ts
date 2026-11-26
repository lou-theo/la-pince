import { devices, expect, type Page, test } from '@playwright/test';

import { tokenFor } from '../src/groups.ts';
import { appUrl } from './app.ts';

// User agents of real iPhones: under iOS 26, Safari keeps saying `OS 18_6` and tells its generation by `Version/26` alone.
const safari18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const safari26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const chromeIos =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1';

const phone = devices['iPhone 15'];
test.use({ viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, isMobile: true, hasTouch: true });
test.skip(({ browserName }) => browserName !== 'webkit', "the iPhone's guides, in Safari's engine");

const token = tokenFor('webkit', 'install');
const open = "Touche l'icône La Pince sur ton écran d'accueil";

/** Goes through the guide by « Suivant » from its current step, each instruction checked, then closes it by « J'ai compris ». */
async function walk(page: Page, instructions: readonly string[]): Promise<void> {
  const guide = page.getByRole('dialog', { name: "Installer l'app" });
  for (const [index, instruction] of instructions.entries()) {
    await expect(guide.getByRole('heading', { level: 3 })).toHaveText(instruction);
    await guide.getByRole('button', { name: index === instructions.length - 1 ? "J'ai compris" : 'Suivant' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Safari before 26', () => {
  test.use({ userAgent: safari18 });

  test('is offered the guide through Share in its bottom bar once it says who it is, and only once', async ({ page }) => {
    await page.goto(`${appUrl()}/g/${token}`);
    await page.getByRole('button', { name: 'Agathe', exact: true }).click();
    const offer = page.getByRole('dialog', { name: "Installer l'app ?" });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: "C'est parti" }).click();
    await expect(page.getByText('Étape 1 sur 5')).toBeVisible();
    await walk(page, [
      "Touche l'icône Partager, en bas de l'écran",
      "Fais défiler jusqu'à « Sur l'écran d'accueil »",
      "Touche « Sur l'écran d'accueil »",
      'Touche « Ajouter » en haut à droite',
      open,
    ]);
    await expect(page.getByText('Tu es Agathe')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Tu es Agathe')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Safari 26', () => {
  test.use({ userAgent: safari26 });

  test('chooses its bar first, the compact one by default, on the screen without a group', async ({ page }) => {
    await page.goto(`${appUrl()}/lien`);
    await page.getByRole('dialog', { name: "Installer l'app ?" }).getByRole('button', { name: "C'est parti" }).click();
    const guide = page.getByRole('dialog', { name: "Installer l'app" });
    await expect(guide.getByRole('heading', { level: 3 })).toHaveText("Qu'est-ce que tu vois en bas de ton écran ?");
    await expect(guide.getByRole('button', { name: 'Une barre avec «\u00a0…\u00a0»' })).toHaveAttribute('aria-pressed', 'true');
    await expect(guide.getByText('Étape 1 sur 7')).toBeVisible();
    await guide.getByRole('button', { name: 'Une barre avec Partager' }).click();
    await expect(guide.getByRole('button', { name: 'Une barre avec Partager' })).toHaveAttribute('aria-pressed', 'true');
    await expect(guide.getByText('Étape 1 sur 6')).toBeVisible();
    await walk(page, [
      "Qu'est-ce que tu vois en bas de ton écran ?",
      "Touche l'icône Partager, en bas de l'écran",
      "Fais défiler jusqu'à « Sur l'écran d'accueil »",
      "Touche « Sur l'écran d'accueil »",
      'Laisse « Ouvrir comme app web » activé, puis touche « Ajouter »',
      open,
    ]);
    await expect(page.getByRole('heading', { name: 'Ouvre ton groupe' })).toBeVisible();
  });
});

test.describe('Chrome on an iPhone', () => {
  test.use({ userAgent: chromeIos });

  test('goes through Share at the end of the address', async ({ page }) => {
    await page.goto(`${appUrl()}/lien`);
    await page.getByRole('dialog', { name: "Installer l'app ?" }).getByRole('button', { name: "C'est parti" }).click();
    await walk(page, [
      "Touche l'icône Partager, à droite de l'adresse",
      "Fais défiler jusqu'à « Ajouter à l'écran d'accueil »",
      "Touche « Ajouter à l'écran d'accueil »",
      'Touche « Ajouter » en haut à droite',
      open,
    ]);
  });
});
