import type { Page } from 'playwright';

export interface Demo {
  /** Where the app answers, with the API behind its proxy. */
  readonly appUrl: string;
  /** Link token of the demo group imported from the corpus. */
  readonly token: string;
}

export interface Screen {
  /** File name of the screenshot. */
  readonly name: string;
  /** Row label on the board. */
  readonly label: string;
  /** Brings a fresh page (nothing remembered) to the screen. Selectors avoid the interface texts, so that the screen is found in the version before. */
  readonly reach: (page: Page, demo: Demo) => Promise<void>;
}

const settle = (page: Page) => page.waitForLoadState('networkidle');

const chooseFirstMember = async (page: Page, demo: Demo): Promise<void> => {
  await page.goto(`${demo.appUrl}/g/${demo.token}`);
  await page.getByRole('list').getByRole('button').first().click();
  await settle(page);
};

/** Screens of the app, in the order of the board; a PR that adds a screen adds it here. */
export const screens: readonly Screen[] = [
  {
    name: 'coller-le-lien',
    label: 'Coller un lien',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/lien`);
      await page.locator('form').waitFor();
    },
  },
  {
    name: 'qui-je-suis',
    label: 'Qui je suis',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/g/${demo.token}`);
      await page.getByRole('list').waitFor();
    },
  },
  { name: 'groupe', label: 'Groupe', reach: chooseFirstMember },
  {
    name: 'groupe-introuvable',
    label: 'Groupe introuvable',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/g/${'x'.repeat(40)}`);
      await page.getByRole('alert').waitFor();
    },
  },
  {
    name: 'lien-invalide',
    label: 'Lien invalide',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/g/court`);
      await settle(page);
    },
  },
];

/** Journey filmed for the GIF, on a phone: paste the link, say who I am, land on the group. */
export async function journey(page: Page, demo: Demo): Promise<void> {
  await page.goto(`${demo.appUrl}/lien`);
  await page.waitForTimeout(600);
  await page.locator('form input').pressSequentially(`${demo.appUrl}/g/${demo.token}`, { delay: 15 });
  await page.waitForTimeout(400);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('list').waitFor();
  await page.waitForTimeout(1000);
  await page.getByRole('list').getByRole('button').first().click();
  await settle(page);
  await page.waitForTimeout(1500);
}
