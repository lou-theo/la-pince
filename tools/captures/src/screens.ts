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
// Lines of the ranking, each opening a member's sheet, the largest balance first.
const memberLine = 'main a[href*="/soldes/membres/"]';
const transfersLink = 'main a[href$="/soldes/virements"]';

// The button that saves a form: in the band since the full-screen form, in the form before.
const saveButton = 'button[type="submit"]';

const chooseFirstMember = async (page: Page, demo: Demo): Promise<void> => {
  await page.goto(`${demo.appUrl}/g/${demo.token}`);
  await page.getByRole('list').getByRole('button').first().click();
  await settle(page);
};

/** Opens the balances, ready once a line is there: a line of the ranking, or of the balances before it. */
const openBalances = async (page: Page, demo: Demo): Promise<void> => {
  await chooseFirstMember(page, demo);
  await page.locator(balancesTab).click();
  await page.locator(`${memberLine}, main section ul > li`).first().waitFor();
};

/** Opens the suggested transfers: their own screen, or below the balances before it. */
const openTransfers = async (page: Page, demo: Demo): Promise<void> => {
  await openBalances(page, demo);
  if ((await page.locator(transfersLink).count()) === 0) {
    await page.locator('main section').last().scrollIntoViewIfNeeded();
    return;
  }
  await page.locator(transfersLink).click();
  // A transfer's button to record it, which the ranking does not have.
  await page.locator('main a[href*="/nouveau-remboursement?"]').first().waitFor();
};

/** Opens the sheet of the first member of the ranking (`first`) or the last one, ready once its button to declare a reimbursement is there. */
const openSheet = async (page: Page, demo: Demo, which: 'first' | 'last'): Promise<void> => {
  await openBalances(page, demo);
  await page.locator(memberLine)[which]().click();
  await page.locator('main a[href*="/nouveau-remboursement?"]').first().waitFor();
};

/** Opens the form of a new expense, ready once its fields are there. */
const openNewExpense = async (page: Page, demo: Demo): Promise<void> => {
  await chooseFirstMember(page, demo);
  await page.locator(newExpenseLink).click();
  await page.locator('form input[inputmode="decimal"]').first().waitFor();
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
      // Mounted but hidden on the other screens, the notifications render nothing while they check: their block shows once they know, on this page.
      await page.locator('main [aria-live="polite"]').locator('..').waitFor();
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
  { name: 'soldes', label: 'Soldes', reach: openBalances },
  {
    name: 'soldes-sombre',
    label: 'Soldes, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openBalances(page, demo);
    },
  },
  { name: 'remboursements-suggeres', label: 'Remboursements suggérés', reach: openTransfers },
  {
    name: 'remboursements-suggeres-sombre',
    label: 'Remboursements suggérés, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openTransfers(page, demo);
    },
  },
  {
    name: 'fiche-crediteur',
    label: 'Fiche de qui est en positif',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheet(page, demo, 'first');
    },
  },
  {
    name: 'fiche-debiteur',
    label: 'Fiche de qui doit',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheet(page, demo, 'last');
    },
  },
  {
    name: 'fiche-debiteur-sombre',
    label: 'Fiche de qui doit, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openSheet(page, demo, 'last');
    },
  },
  {
    name: 'nouvelle-depense',
    label: 'Nouvelle dépense',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openNewExpense(page, demo);
      await page.locator('form input[type="text"]').first().fill('Pizzas');
      await page.locator('form input[inputmode="decimal"]').first().fill('26,00');
    },
  },
  {
    name: 'nouvelle-depense-sombre',
    label: 'Nouvelle dépense, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openNewExpense(page, demo);
    },
  },
  {
    name: 'depense-par-montants',
    label: 'Dépense par montants, total en contrôle',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openNewExpense(page, demo);
      const mode = page.locator('form select:has(option[value="amounts"])');
      if ((await mode.count()) > 0) {
        await mode.selectOption('amounts');
        // Two more members, from the avatars offered below the lines.
        for (let added = 0; added < 2; added += 1) {
          await page.locator('form button[aria-pressed="false"]').first().click();
        }
      } else {
        // shortcut: the form before the full-screen one, with mode buttons; to remove once no compared version has it.
        await page.locator('fieldset button[aria-pressed]').nth(1).click();
      }
      // The control total, then the first lines: what is left shows.
      const amounts = page.locator('form input[inputmode="decimal"]');
      await amounts.nth(0).fill('26,00');
      await amounts.nth(1).fill('8,00');
      await amounts.nth(2).fill('6,00');
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
      await openTransfers(page, demo);
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

/** Journey filmed for the GIF, on a phone: paste the link, say who I am, land on the group, open an expense, the balances, their transfers and a sheet, then add an expense. */
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
  await page.locator(transfersLink).click();
  await page.waitForTimeout(1500);
  await page.locator(balancesTab).click();
  await page.waitForTimeout(800);
  await page.locator(memberLine).last().click();
  await page.waitForTimeout(1500);
  await page.locator('nav a').first().click();
  await page.locator(newExpenseLink).click();
  await page.locator('form input[type="text"]').first().pressSequentially('Glaces', { delay: 40 });
  await page.locator('form input[inputmode="decimal"]').first().pressSequentially('12,60', { delay: 40 });
  await page.waitForTimeout(600);
  // Two more members in the grid, who I am being checked already.
  for (let added = 0; added < 2; added += 1) {
    await page.locator('form button[aria-pressed="false"]').first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  await page.locator(saveButton).click();
  await page.locator('article').waitFor();
  await page.waitForTimeout(2000);
}
