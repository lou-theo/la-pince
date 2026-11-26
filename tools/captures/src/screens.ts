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
// Lines of the ranking, each opening a member's sheet, the largest balance first: under the balances' address before, at their own since.
const memberLine = 'main a[href*="membres/"]';
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
  // A transfer's line, under its debtor's card, which the ranking does not have.
  await page.locator('main li li').first().waitFor();
};

/**
 * Records the first suggested transfer by its button, ready once the band offering to undo it shows. The send is held, never answered: the shot
 * must not change the demo group the next screens are shot on.
 */
const payFirstTransfer = async (page: Page, demo: Demo): Promise<void> => {
  await openTransfers(page, demo);
  await page.route('**/api/groups/*/operations', () => new Promise(() => undefined));
  await page.locator('main li li button').first().click();
  await page.locator('main [role="status"]').waitFor();
};

/** Opens the reimbursement page by the first link to it of a screen: “Déclarer un autre remboursement” on the transfers, the prefilled form before. */
const openReimbursement = async (page: Page): Promise<void> => {
  await page.locator('main a[href*="/nouveau-remboursement"]').first().click();
  await page.locator('form').waitFor();
  // The grid of the side to choose, which the form before did not have; nothing to wait for there.
  await page
    .locator('form section button')
    .first()
    .waitFor({ timeout: 1000 })
    .catch(() => undefined);
};

/** Opens the sheet of the first member of the ranking (`first`) or the last one, ready once its button to declare a reimbursement is there. */
const openSheet = async (page: Page, demo: Demo, which: 'first' | 'last'): Promise<void> => {
  await openBalances(page, demo);
  await page.locator(memberLine)[which]().click();
  await page.locator('main a[href*="/nouveau-remboursement?"]').first().waitFor();
};

/** Opens my page by the avatar of the band, ready once the notifications know what to show (mounted but hidden elsewhere, empty while checking). */
const openMe = async (page: Page, demo: Demo): Promise<void> => {
  await chooseFirstMember(page, demo);
  await page.locator('header a[href$="/moi"]').click();
  await page.locator('main [aria-live="polite"]').locator('..').waitFor();
};

/** Opens the tab of the group on my page, ready once its members are there. */
const openGroupTab = async (page: Page, demo: Demo): Promise<void> => {
  await openMe(page, demo);
  await page.locator('header a[href$="/moi/groupe"]').click();
  await page.locator('main li a[href*="membres/"]').first().waitFor();
};

/** Opens the sheet of the second member of the group from its tab, ready once its button to declare a reimbursement is there. */
const openSheetFromGroup = async (page: Page, demo: Demo): Promise<void> => {
  await openGroupTab(page, demo);
  await page.locator('main li a[href*="membres/"]').nth(1).click();
  await page.locator('main a[href*="/nouveau-remboursement?"]').first().waitFor();
};

/** Opens the sheet to add a member, a first name typed and never sent: the demo group stays as it is. */
const openAddMember = async (page: Page, demo: Demo): Promise<void> => {
  await openGroupTab(page, demo);
  await page.route('**/api/groups/*/members', () => new Promise(() => undefined));
  await page.locator('main li:last-child > button').click();
  await page.locator('dialog[open] input[type="text"]').fill('Zoé');
};

/** The camera badge on the corner of the big avatar of a sheet. */
const photoBadge = 'main span[aria-hidden="true"] + button:has(+ input[type="file"])';

/** A picture drawn by the browser, flat quadrants (never a photo of a person), as a file to choose. */
const drawnPicture = async (page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> => {
  // A page of its own, at one pixel per pixel: the phone's context would scale and zoom the drawing.
  const browser = page.context().browser();
  if (browser === null) {
    throw new Error('no browser to draw the picture');
  }
  const painter = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  try {
    await painter.setContent(
      '<body style="margin:0;display:grid;grid-template:1fr 1fr/1fr 1fr;width:1200px;height:800px">' +
        ['#e9a23b', '#3b82c4', '#2f6b4f', '#c2410c'].map((color) => `<div style="background:${color}"></div>`).join('') +
        '</body>',
    );
    return { name: 'motif.png', mimeType: 'image/png', buffer: await painter.screenshot() };
  } finally {
    await painter.close();
  }
};

/**
 * Changes the photo of the member of the sheet open, ready once the band offering to undo it shows. The server's answer is made up from the group
 * as it is, the photo unchanged: the shot must not change the demo group the next screens are shot on.
 */
const changePhoto = async (page: Page, demo: Demo): Promise<void> => {
  await page.route('**/api/groups/*/members/*/photo', async (route) => {
    const group = (await (await page.request.get(`${demo.appUrl}/api/groups/${demo.token}`)).json()) as { members: { id: string; photo?: string }[] };
    const id = /members\/([^/]+)\/photo$/.exec(route.request().url())?.[1];
    const version = group.members.find((member) => member.id === id)?.photo ?? null;
    await route.fulfill({ json: { ...group, ...(version === null ? {} : { undo: { version, previous: null } }) } });
  });
  const chooser = page.waitForEvent('filechooser');
  // Awaited below: a version without the badge fails at its click first.
  chooser.catch(() => undefined);
  await page.locator(photoBadge).click();
  const menu = page.locator('dialog[open] button:not([aria-label])').first();
  // A member with a photo: the sheet offers to choose another, first.
  if ((await menu.count()) > 0) {
    await menu.click();
  }
  await (await chooser).setFiles(await drawnPicture(page));
  await page.locator('main [role="status"] button').waitFor();
};

// The pills under the group's title: « Me concerne », « Payé par moi », then the one that opens the sheet of the filters; the sheet, in the band
// too, has groups of its own.
const filterPills = 'header > div > [role="group"] button';
// The grid of the members, a dialog over the sheet, and its button that applies the choice.
const memberGrid = 'dialog[open] dialog[open]';
const applyGrid = `${memberGrid} > div > button:last-child`;

/** Opens the sheet of the filters by its pill, ready once it shows. */
const openFilterSheet = async (page: Page, demo: Demo): Promise<void> => {
  await chooseFirstMember(page, demo);
  await page.locator(filterPills).last().click();
  await page.locator('dialog[open]').waitFor();
};

/** In the sheet, opens the grid of a block of members (0 who paid, 1 who is involved) and touches some, by their place in the group. */
const pickMembers = async (page: Page, block: number, places: readonly number[]): Promise<void> => {
  // The last badge of the block, « Ajouter »; the grid, inside the block, has buttons of its own.
  await page.locator('dialog[open] section').nth(block).locator(':scope > ul > li:last-child > button').click();
  for (const place of places) {
    await page.locator(`${memberGrid} ul button`).nth(place).click();
  }
};

/** The filters of the mock-up set in the sheet, left open: paid by the 2nd or 6th member, involving me and the 2nd, 20 € or more. */
const fillFilterSheet = async (page: Page, demo: Demo): Promise<void> => {
  await openFilterSheet(page, demo);
  await pickMembers(page, 0, [1, 5]);
  await page.locator(applyGrid).click();
  await pickMembers(page, 1, [0, 1]);
  await page.locator(applyGrid).click();
  await page.locator('dialog[open] input[inputmode="decimal"]').first().fill('20');
};

/** The list under those filters, the sheet closed by its last button: the summary in the band, the heading over the list. */
const filteredList = async (page: Page, demo: Demo): Promise<void> => {
  await fillFilterSheet(page, demo);
  await page.locator('dialog[open] > div > button:last-child').click();
  await page.locator('header > div > div > button[aria-haspopup="dialog"]').waitFor();
};

/** Opens the form of a new expense, ready once its fields are there. */
const openNewExpense = async (page: Page, demo: Demo): Promise<void> => {
  await chooseFirstMember(page, demo);
  await page.locator(newExpenseLink).click();
  await page.locator('form input[inputmode="decimal"]').first().waitFor();
};

// What a phone's Chrome says of itself: the offer to install the app comes on a phone only.
const androidChrome = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/**
 * Makes the page an Android Chrome, before the app starts. With `window`, Chrome hands its install window, which answers « Installer » after
 * `acceptAfter` ms (never without it, the window staying open); without, Chrome hands none and the app offers its ⋮ menu.
 */
const asAndroidChrome = async (page: Page, window: boolean, acceptAfter?: number): Promise<void> => {
  await page.addInitScript(
    ({ userAgent, hand, delay }) => {
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent });
      if (!hand) {
        return;
      }
      addEventListener('load', () => {
        let accept = (): void => undefined;
        const userChoice = new Promise((resolve) => {
          accept = () => {
            resolve({ outcome: 'accepted', platform: 'web' });
          };
        });
        const prompt = () => {
          if (delay !== null) {
            setTimeout(accept, delay);
          }
          return Promise.resolve();
        };
        dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice }));
      });
    },
    { userAgent: androidChrome, hand: window, delay: acceptAfter ?? null },
  );
};

// The sheet of the offer, then of the guide: a modal dialog, its main button the last one but « Plus tard » on the offer.
const sheet = 'dialog[open]';

/** Brings the offer over the group, at rest: still pictures show La Pince on the point, the animations stopped. */
const openOffer = async (page: Page, demo: Demo, window = true, acceptAfter?: number): Promise<void> => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asAndroidChrome(page, window, acceptAfter);
  await chooseFirstMember(page, demo);
  // Without a window, Chrome is given 3 s before its menu is offered.
  await page.locator(sheet).waitFor({ timeout: 6000 });
};

/** Opens the guide from the offer, at its step `step` (1 first) by its main button. */
const openGuide = async (page: Page, demo: Demo, window: boolean, step: number, acceptAfter?: number): Promise<void> => {
  await openOffer(page, demo, window, acceptAfter);
  await page.locator(`${sheet} button`).first().click();
  for (let at = 1; at < step; at += 1) {
    await page.locator(`${sheet} button`).last().click();
  }
  await page.locator(`${sheet} svg image`).first().waitFor();
};

// What iPhone browsers say of themselves: under iOS 26, Safari keeps `OS 18_6` and tells its generation by `Version/26` alone.
const iphones = {
  safari18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  safari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
} as const;
type Iphone = keyof typeof iphones;

/** Makes the page an iPhone's browser, before the app starts. */
const asIphone = async (page: Page, browser: Iphone): Promise<void> => {
  await page.addInitScript((userAgent) => {
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent });
  }, iphones[browser]);
};

/**
 * Opens the guide of an iPhone's browser from the offer, at rest, at its step `step` (1 first) by its main button; with `bar`, Safari 26's bar of
 * buttons chosen at its first step rather than the compact one.
 */
const openIphoneGuide = async (page: Page, demo: Demo, browser: Iphone, step: number, bar = false): Promise<void> => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asIphone(page, browser);
  await chooseFirstMember(page, demo);
  await page.locator(sheet).waitFor();
  await page.locator(`${sheet} button`).first().click();
  if (bar) {
    await page.locator(`${sheet} button[aria-pressed]`).last().click();
  }
  for (let at = 1; at < step; at += 1) {
    await page.locator(`${sheet} button`).last().click();
  }
  await page.locator(`${sheet} h3`).waitFor();
};

// What Android browsers other than Chrome say of themselves: Firefox installs from its own menu, Samsung Internet cannot install.
const otherAndroids = {
  firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
} as const;
type OtherAndroid = keyof typeof otherAndroids;

/** Makes the page an Android browser other than Chrome, before the app starts: no install window reaches the app, and a clipboard takes the link. */
const asOtherAndroid = async (page: Page, browser: OtherAndroid): Promise<void> => {
  await page.addInitScript((userAgent) => {
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent });
    addEventListener(
      'beforeinstallprompt',
      (event) => {
        event.stopImmediatePropagation();
      },
      { capture: true },
    );
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
  }, otherAndroids[browser]);
};

/**
 * Opens the guide of an Android browser other than Chrome from the offer, at rest: Firefox at its step `step` (1 first); a browser that cannot
 * install at its word with `step` 0, at the step `step` of its shortcut otherwise; with `copy`, its link copied.
 */
const openOtherAndroidGuide = async (page: Page, demo: Demo, browser: OtherAndroid, step: number, copy = false): Promise<void> => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asOtherAndroid(page, browser);
  await chooseFirstMember(page, demo);
  // Samsung Internet is given 3 s to hand its install window.
  await page.locator(sheet).waitFor({ timeout: 6000 });
  await page.locator(`${sheet} button`).first().click();
  if (browser === 'samsung') {
    await page.locator(`${sheet} a[href^="intent:"]`).waitFor();
    if (copy) {
      await page.locator(`${sheet} a + div button`).click();
    }
    if (step > 0) {
      await page.locator(`${sheet} button`).last().click();
    }
  }
  for (let at = 1; at < step; at += 1) {
    await page.locator(`${sheet} button`).last().click();
  }
  await page.locator(`${sheet} h3`).waitFor();
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
    name: 'filtres-me-concerne',
    label: 'Filtre « Me concerne » : en-tête du résultat',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await chooseFirstMember(page, demo);
      await page.locator(filterPills).first().click();
      await page.locator(`${filterPills}[aria-pressed="true"]`).waitFor();
    },
  },
  { name: 'filtres-feuille', label: 'Feuille des filtres', reach: fillFilterSheet },
  {
    name: 'filtres-feuille-sombre',
    label: 'Feuille des filtres, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await fillFilterSheet(page, demo);
    },
  },
  {
    name: 'filtres-choix',
    label: 'Choix des concernés',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openFilterSheet(page, demo);
      await pickMembers(page, 1, [0, 1]);
    },
  },
  { name: 'filtres-resume', label: 'Liste filtrée : résumé et en-tête', reach: filteredList },
  {
    name: 'filtres-resume-sombre',
    label: 'Liste filtrée, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await filteredList(page, demo);
    },
  },
  { name: 'moi', label: 'Toi : ta fiche et ce téléphone', reach: openMe },
  {
    name: 'moi-sombre',
    label: 'Toi, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openMe(page, demo);
    },
  },
  { name: 'moi-groupe', label: 'Le groupe', reach: openGroupTab },
  {
    name: 'moi-groupe-sombre',
    label: 'Le groupe, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openGroupTab(page, demo);
    },
  },
  {
    name: 'moi-groupe-hors-ligne',
    label: 'Le groupe, hors ligne : commandes grisées',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openGroupTab(page, demo);
      await page.context().setOffline(true);
      await page.locator('main li:last-child > button:disabled').waitFor();
    },
  },
  { name: 'fiche-depuis-groupe', label: 'Fiche ouverte depuis Le groupe', reach: openSheetFromGroup },
  {
    name: 'renommage-ouvert',
    label: 'Renommer un membre sur sa fiche',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheetFromGroup(page, demo);
      // Visible: the sheet of a photo, closed, has a title and a button too.
      await page.locator('main h2 + button:visible').first().click();
      await page.locator('main form input[type="text"]').waitFor();
    },
  },
  {
    name: 'fiche-photo-menu',
    label: "Pastille d'un membre avec photo : choisir ou retirer",
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheetFromGroup(page, demo);
      await page.locator(photoBadge).click();
      await page.locator('dialog[open]').waitFor();
    },
  },
  {
    name: 'fiche-photo-changee',
    label: 'Photo changée : bandeau « Annuler » de 15 s',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheetFromGroup(page, demo);
      await changePhoto(page, demo);
    },
  },
  { name: 'ajout-membre', label: 'Nouveau membre, feuille ouverte', reach: openAddMember },
  {
    name: 'ajout-membre-photo',
    label: 'Nouveau membre, photo choisie',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openAddMember(page, demo);
      await page.locator('dialog[open] input[type="file"]').setInputFiles(await drawnPicture(page));
      await page.locator('dialog[open] button img').waitFor();
    },
  },
  {
    name: 'ajout-membre-sombre',
    label: 'Nouveau membre, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openAddMember(page, demo);
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
  { name: 'virement-paye', label: "« C'est payé » : ligne « Payé » et « Annuler »", reach: payFirstTransfer },
  {
    name: 'virement-paye-sombre',
    label: "« C'est payé », thème sombre",
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await payFirstTransfer(page, demo);
    },
  },
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
    name: 'fiche-paye',
    label: "« C'est payé » sur une fiche, bandeau sans menu",
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheet(page, demo, 'last');
      await page.route('**/api/groups/*/operations', () => new Promise(() => undefined));
      await page.locator('main li button').first().click();
      await page.locator('main [role="status"]').waitFor();
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
    label: 'Remboursement depuis les virements',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openTransfers(page, demo);
      await openReimbursement(page);
    },
  },
  {
    name: 'nouveau-remboursement-sombre',
    label: 'Remboursement, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openTransfers(page, demo);
      await openReimbursement(page);
    },
  },
  {
    name: 'remboursement-depuis-fiche',
    label: 'Remboursement depuis la fiche de qui est en positif',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openSheet(page, demo, 'first');
      await openReimbursement(page);
    },
  },
  {
    name: 'installation-proposition',
    label: "Proposition d'installer l'app, à l'arrivée sur un téléphone",
    reach: (page, demo) => openOffer(page, demo),
  },
  {
    name: 'installation-proposition-sombre',
    label: 'Proposition, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openOffer(page, demo);
    },
  },
  { name: 'installation-bouton', label: 'Guide Android, 1 : le bouton « Installer »', reach: (page, demo) => openGuide(page, demo, true, 1) },
  {
    name: 'installation-bouton-fenetre',
    label: 'Guide Android, 2 : la fenêtre du navigateur',
    reach: (page, demo) => openGuide(page, demo, true, 2),
  },
  {
    name: 'installation-bouton-installee',
    label: "Guide Android, 3 : l'icône à toucher",
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await openGuide(page, demo, true, 2, 0);
      // The home screen drawn, once the window is accepted.
      await page.locator(`${sheet} svg linearGradient`).waitFor({ state: 'attached' });
    },
  },
  {
    name: 'installation-bouton-sombre',
    label: 'Guide Android, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openGuide(page, demo, true, 1);
    },
  },
  { name: 'installation-menu', label: 'Guide de Chrome sans fenêtre, 1 : le menu ⋮', reach: (page, demo) => openGuide(page, demo, false, 1) },
  {
    name: 'installation-menu-entree',
    label: "Guide de Chrome sans fenêtre, 2 : « Installer l'application »",
    reach: (page, demo) => openGuide(page, demo, false, 2),
  },
  {
    name: 'installation-iphone-safari',
    label: 'Guide de Safari avant iOS 26, 1 : Partager dans la barre du bas',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari18', 1),
  },
  {
    name: 'installation-iphone-safari-defiler',
    label: 'Guide de Safari avant iOS 26, 2 : la feuille de partage',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari18', 2),
  },
  {
    name: 'installation-iphone-safari-ajouter',
    label: 'Guide de Safari avant iOS 26, 4 : « Ajouter »',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari18', 4),
  },
  {
    name: 'installation-iphone-safari-icone',
    label: "Guide de l'iPhone, dernière étape : l'icône à toucher",
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari18', 5),
  },
  {
    name: 'installation-iphone-26-choix',
    label: 'Guide de Safari 26, 1 : quelle barre',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari26', 1),
  },
  {
    name: 'installation-iphone-26-sombre',
    label: 'Guide de Safari 26, quelle barre, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openIphoneGuide(page, demo, 'safari26', 1);
    },
  },
  {
    name: 'installation-iphone-26-menu',
    label: 'Guide de Safari 26, barre compacte, 2 : « … »',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari26', 2),
  },
  {
    name: 'installation-iphone-26-partager',
    label: 'Guide de Safari 26, barre compacte, 3 : « Partager »',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari26', 3),
  },
  {
    name: 'installation-iphone-26-ajouter',
    label: 'Guide de Safari 26, 6 : « Ouvrir comme app web » et « Ajouter »',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari26', 6),
  },
  {
    name: 'installation-iphone-26-barre',
    label: 'Guide de Safari 26, barre avec Partager, 2 : Partager',
    reach: (page, demo) => openIphoneGuide(page, demo, 'safari26', 2, true),
  },
  {
    name: 'installation-iphone-chrome',
    label: "Guide de Chrome sur iPhone, 1 : Partager au bout de l'adresse",
    reach: (page, demo) => openIphoneGuide(page, demo, 'chrome', 1),
  },
  {
    name: 'installation-iphone-chrome-entree',
    label: "Guide de Chrome sur iPhone, 3 : « Ajouter à l'écran d'accueil »",
    reach: (page, demo) => openIphoneGuide(page, demo, 'chrome', 3),
  },
  {
    name: 'installation-firefox',
    label: 'Guide de Firefox sur Android, 1 : le menu ⋮',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'firefox', 1),
  },
  {
    name: 'installation-firefox-plus',
    label: 'Guide de Firefox sur Android, 2 : « Plus »',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'firefox', 2),
  },
  {
    name: 'installation-firefox-entree',
    label: "Guide de Firefox sur Android, 3 : « Ajouter l'application à l'écran d'accueil »",
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'firefox', 3),
  },
  {
    name: 'installation-firefox-ajouter',
    label: "Guide de Firefox sur Android, 4 : la fenêtre de l'écran d'accueil",
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'firefox', 4),
  },
  {
    name: 'installation-incapable',
    label: 'Navigateur qui ne sait pas installer : Chrome recommandé',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'samsung', 0),
  },
  {
    name: 'installation-incapable-copie',
    label: 'Navigateur qui ne sait pas installer : lien copié',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'samsung', 0, true),
  },
  {
    name: 'installation-incapable-sombre',
    label: 'Navigateur qui ne sait pas installer, thème sombre',
    reach: async (page: Page, demo: Demo): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openOtherAndroidGuide(page, demo, 'samsung', 0);
    },
  },
  {
    name: 'installation-raccourci',
    label: 'Raccourci quand même, 1 : le menu',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'samsung', 1),
  },
  {
    name: 'installation-raccourci-ajouter',
    label: 'Raccourci quand même, 3 : « Ajouter »',
    reach: (page, demo) => openOtherAndroidGuide(page, demo, 'samsung', 3),
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

/**
 * Journey filmed for the GIF of the install, on a phone's Chrome: the offer at the arrival, the guide, the browser's window accepted after 3 s, and
 * the icon to touch.
 */
export async function installJourney(page: Page, demo: Demo): Promise<void> {
  await asAndroidChrome(page, true, 3000);
  await page.goto(`${demo.appUrl}/g/${demo.token}`);
  await page.getByRole('list').waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('list').getByRole('button').first().click();
  await page.locator(sheet).waitFor();
  await page.waitForTimeout(3000);
  await page.locator(`${sheet} button`).first().click();
  await page.waitForTimeout(4000);
  await page.locator(`${sheet} button`).last().click();
  // The window, then the icon to touch once accepted.
  await page.waitForTimeout(7500);
  await page.locator(`${sheet} button`).last().click();
  await page.waitForTimeout(800);
}

/**
 * Journey filmed for the GIF of an iPhone's guide: the offer at the arrival, then each step of the guide of `browser` long enough for its gesture to
 * play, through `steps` steps; Safari 26 keeps its compact bar, the default.
 */
export const iphoneJourney =
  (browser: Iphone, steps: number) =>
  async (page: Page, demo: Demo): Promise<void> => {
    await asIphone(page, browser);
    await page.goto(`${demo.appUrl}/g/${demo.token}`);
    await page.getByRole('list').waitFor();
    await page.waitForTimeout(800);
    await page.getByRole('list').getByRole('button').first().click();
    await page.locator(sheet).waitFor();
    await page.waitForTimeout(2500);
    await page.locator(`${sheet} button`).first().click();
    for (let step = 1; step <= steps; step += 1) {
      await page.waitForTimeout(3600);
      await page.locator(`${sheet} button`).last().click();
    }
    await page.waitForTimeout(800);
  };

/**
 * Journey filmed for the GIF of an Android browser other than Chrome: the offer at the arrival, then Firefox's guide through its `steps` steps; or
 * the word of a browser that cannot install, its link copied, and the `steps` steps of its shortcut.
 */
export const otherAndroidJourney =
  (browser: OtherAndroid, steps: number) =>
  async (page: Page, demo: Demo): Promise<void> => {
    await asOtherAndroid(page, browser);
    await page.goto(`${demo.appUrl}/g/${demo.token}`);
    await page.getByRole('list').waitFor();
    await page.waitForTimeout(800);
    await page.getByRole('list').getByRole('button').first().click();
    await page.locator(sheet).waitFor({ timeout: 6000 });
    await page.waitForTimeout(2500);
    await page.locator(`${sheet} button`).first().click();
    if (browser === 'samsung') {
      await page.waitForTimeout(2500);
      await page.locator(`${sheet} a + div button`).click();
      await page.waitForTimeout(2000);
      await page.locator(`${sheet} button`).last().click();
    }
    for (let step = 1; step <= steps; step += 1) {
      await page.waitForTimeout(3600);
      await page.locator(`${sheet} button`).last().click();
    }
    await page.waitForTimeout(800);
  };

/**
 * Journey filmed for the GIF, on a phone: paste the link, say who I am, land on the group, filter it (« Me concerne », then the sheet: who paid,
 * an amount), open an expense and come back to the list still filtered, clear the filters, open an expense, the balances, their transfers with
 * one paid then undone, and a sheet, then add an expense.
 */
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
  await page.locator(filterPills).first().click();
  await page.waitForTimeout(1500);
  await page.locator(filterPills).first().click();
  await page.locator(filterPills).last().click();
  await page.waitForTimeout(800);
  await pickMembers(page, 0, [1, 5]);
  await page.waitForTimeout(800);
  await page.locator(applyGrid).click();
  await page.waitForTimeout(600);
  await page.locator('dialog[open] input[inputmode="decimal"]').first().pressSequentially('20', { delay: 80 });
  await page.waitForTimeout(800);
  await page.locator('dialog[open] > div > button:last-child').click();
  await page.waitForTimeout(1500);
  await page.locator(operationLink).first().click();
  await page.waitForTimeout(1200);
  await page.locator('nav a').first().click();
  await page.waitForTimeout(1500);
  // The cross beside the summary clears every filter.
  await page.locator('header > div > div > button[aria-haspopup="dialog"] + button').click();
  await page.waitForTimeout(1000);
  await page.locator(operationLink).first().click();
  await page.waitForTimeout(1500);
  await page.locator(balancesTab).click();
  await page.waitForTimeout(2000);
  await page.locator(transfersLink).click();
  await page.waitForTimeout(1500);
  // A transfer paid, then undone: the demo group ends as it was.
  await page.locator('main li li button').first().click();
  await page.waitForTimeout(1800);
  await page.locator('main [role="status"] button').click();
  await page.waitForTimeout(1200);
  await page.locator(balancesTab).click();
  await page.waitForTimeout(800);
  await page.locator(memberLine).last().click();
  await page.waitForTimeout(1500);
  // Back to the balances by the sheet's arrow, then to the expenses by the menu.
  await page.locator('header a[href$="/soldes"]').click();
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
