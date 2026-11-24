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

const operationLink = 'main a[href*="/operations/"]';
const balancesTab = 'nav a[href$="/soldes"]';
const newExpenseLink = 'main a[href$="/nouvelle-depense"]';

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
  { name: 'groupe', label: 'Groupe, ses dépenses', reach: chooseFirstMember },
  {
    name: 'groupe-sombre',
    label: 'Ses dépenses, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await chooseFirstMember(page, demo);
    },
  },
  {
    name: 'moi',
    label: 'Qui je suis, notifications',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator('header a[href$="/moi"]').click();
      // The notifications render nothing while they check the server and the browser: their status line appears once they know.
      await page.locator('main [aria-live="polite"]').waitFor({ state: 'attached' });
    },
  },
  {
    name: 'depense',
    label: 'Une dépense',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(operationLink).first().click();
      await page.locator('article').waitFor();
    },
  },
  {
    name: 'soldes',
    label: 'Soldes',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(balancesTab).click();
      // The list has sections too, one per day: those of the balances are named by their heading.
      await page.locator('main section[aria-labelledby]').first().waitFor();
    },
  },
  {
    name: 'remboursements-suggeres',
    label: 'Remboursements suggérés',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(balancesTab).click();
      // Below the balances, out of the first screen.
      await page.locator('main section').last().scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'nouvelle-depense',
    label: 'Nouvelle dépense',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(newExpenseLink).click();
      await page.locator('form').waitFor();
    },
  },
  {
    name: 'depense-par-montants',
    label: 'Dépense par montants',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(newExpenseLink).click();
      await page.locator('fieldset button[aria-pressed]').nth(1).click();
    },
  },
  {
    name: 'modifier-depense',
    label: 'Modifier une dépense',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(operationLink).first().click();
      await page.locator('a[href$="/modifier"]').click();
      await page.locator('form').waitFor();
    },
  },
  {
    name: 'nouveau-remboursement',
    label: 'Remboursement suggéré',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(balancesTab).click();
      await page.locator('a[href*="/nouveau-remboursement?"]').first().click();
      await page.locator('form').waitFor();
    },
  },
  {
    name: 'groupe-introuvable',
    label: 'Groupe introuvable',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/g/${'x'.repeat(40)}`);
      // The way to another link, shown for an unknown group only (other errors offer to retry).
      await page.locator('a[href="/lien"]').waitFor();
    },
  },
  {
    name: 'lien-invalide',
    label: 'Lien invalide',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.goto(`${demo.appUrl}/g/court`);
      await page.locator('a[href="/lien"]').waitFor();
    },
  },
];

/** Journey filmed for the GIF, on a phone: paste the link, say who I am, land on the group, open an expense, the balances, then add an expense. */
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
  await page.locator(operationLink).first().click();
  await page.waitForTimeout(1500);
  await page.locator(balancesTab).click();
  await page.waitForTimeout(2000);
  await page.locator('nav a').first().click();
  await page.locator(newExpenseLink).click();
  await page.locator('form input[type="text"]').first().pressSequentially('Glaces', { delay: 40 });
  await page.locator('form input[inputmode="decimal"]').first().pressSequentially('12,60', { delay: 40 });
  await page.waitForTimeout(1200);
  await page.locator('form button[type="submit"]').click();
  await page.locator('article').waitFor();
  await page.waitForTimeout(2000);
}
