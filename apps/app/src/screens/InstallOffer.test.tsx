import { groupResponseSchema } from '@la-pince/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureInstallPrompt, type InstallOutcome, type InstallPlatform } from '../install/platform.ts';
import type { PromptState } from '../model/install.ts';
import { wasInstallOffered } from '../storage/device.ts';
import { fakeServer } from '../testing/fake-server.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { renderApp } from '../testing/render.tsx';
import { InstallGuideLink, InstallOffer } from './InstallOffer.tsx';

const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const samsung = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const safari18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
// Under iOS 26, Safari's `OS 18_6` stays put: only `Version/26` tells it.
const safari26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const chromeIos =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1';
const firefoxIos =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const firefox = 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0';
const oldAndroid =
  'Mozilla/5.0 (Linux; U; Android 4.4.2; fr-fr; GT-I9505 Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';
const inApp =
  'Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 356.0.0.41.101';

/** A browser saying `userAgent`, whose install window is in `prompt` and answers `answer`; `hand` and `lose` change it as Chromium would. */
function browser({
  userAgent = chrome,
  standalone = false,
  prompt = 'available',
  answer = 'accepted',
}: { userAgent?: string; standalone?: boolean; prompt?: PromptState; answer?: InstallOutcome } = {}) {
  const state = { prompt, installs: 0 };
  const listeners = new Set<() => void>();
  const set = (next: PromptState) => {
    state.prompt = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const platform: InstallPlatform = {
    environment: () => ({ userAgent, maxTouchPoints: 5, standalone }),
    prompt: () => state.prompt,
    onPromptChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    install: () => {
      state.installs += 1;
      set('absent');
      return Promise.resolve(answer);
    },
  };
  return {
    platform,
    state,
    set: (next: PromptState) => {
      act(() => {
        set(next);
      });
    },
  };
}

const offerTitle = "Installer l'app ?";
const cannotTitle = "Ce navigateur ne sait pas installer l'app";
const step = (number: number, total: number) => screen.getByText(`Étape ${String(number)} sur ${String(total)}`);

/** Goes through the guide by « Suivant », checking each instruction, its step, and what the phone drawn shows or not. */
async function walk(
  user: ReturnType<typeof userEvent.setup>,
  steps: readonly (readonly [instruction: string, drawn?: string | undefined, notDrawn?: string])[],
  from = 1,
) {
  const total = from - 1 + steps.length;
  for (const [index, [instruction, drawn, notDrawn]] of steps.entries()) {
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(instruction);
    expect(step(from + index, total)).toBeDefined();
    if (drawn !== undefined) {
      expect(screen.getByText(drawn, { selector: 'text' })).toBeDefined();
    }
    if (notDrawn !== undefined) {
      expect(screen.queryByText(notDrawn, { selector: 'text' })).toBeNull();
    }
    if (index < steps.length - 1) {
      await user.click(screen.getByRole('button', { name: 'Suivant' }));
    }
  }
}

describe('offer to install the app', () => {
  it("guides Android Chrome through the browser's window opened by the app's own button, and is offered once", async () => {
    const user = userEvent.setup();
    const { platform, state } = browser();
    render(<InstallOffer title="Week-end" platform={platform} />);
    expect(screen.getByRole('dialog', { name: offerTitle })).toBeDefined();
    expect(screen.getByText('Suis La Pince !')).toBeDefined();
    expect(wasInstallOffered()).toBe(true);

    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(screen.getByRole('dialog', { name: "Installer l'app" })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: "Installer l'app" }));
    expect(step(1, 3)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Touche « Installer » ci-dessous' })).toBeDefined();
    // The phone drawn shows the group and the address of the app.
    expect(screen.getByText('Week-end', { selector: 'text' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Précédent' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(state.installs).toBe(1);
    expect(await screen.findByRole('heading', { name: "C'est installé : touche l'icône La Pince sur ton écran d'accueil" })).toBeDefined();
    expect(step(3, 3)).toBeDefined();
    // Installed: no way back to a window that opens once.
    expect(screen.getByRole('button', { name: 'Précédent' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: "J'ai compris" }));
    expect(screen.queryByRole('dialog')).toBeNull();

    cleanup();
    render(<InstallOffer platform={browser().platform} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("closes when the person dismisses the browser's window", async () => {
    const user = userEvent.setup();
    render(<InstallOffer platform={browser({ answer: 'dismissed' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    await user.click(screen.getByRole('button', { name: 'Installer' }));
    await act(() => Promise.resolve());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("goes through Chrome's menu when the window cannot open, and says another browser cannot install", async () => {
    const user = userEvent.setup();
    render(<InstallOffer platform={browser({ answer: 'unavailable' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(await screen.findByRole('heading', { name: 'Touche ⋮ en haut à droite' })).toBeDefined();
    cleanup();
    localStorage.clear();

    render(<InstallOffer platform={browser({ userAgent: samsung, answer: 'unavailable' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(await screen.findByRole('heading', { name: cannotTitle })).toBeDefined();
  });

  it('walks Chrome without a window through its ⋮ menu, a step at a time, back and forth', async () => {
    const user = userEvent.setup();
    render(<InstallOffer platform={browser({ prompt: 'absent' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(step(1, 4)).toBeDefined();
    expect(screen.getByText("Déjà installée ? Ouvre La Pince depuis ton écran d'accueil.")).toBeDefined();
    const instructions = [
      'Touche ⋮ en haut à droite',
      "Touche « Installer l'application »",
      'Touche « Installer »',
      "Touche l'icône La Pince sur ton écran d'accueil",
    ];
    for (const [index, instruction] of instructions.entries()) {
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(instruction);
      expect(step(index + 1, 4)).toBeDefined();
      if (index < instructions.length - 1) {
        await user.click(screen.getByRole('button', { name: 'Suivant' }));
      }
    }
    await user.click(screen.getByRole('button', { name: 'Précédent' }));
    expect(step(3, 4)).toBeDefined();
    // The cross leaves the guide halfway: not offered again.
    await user.click(screen.getByRole('button', { name: 'Fermer le guide' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wasInstallOffered()).toBe(true);
  });

  it("waits for Android Chromium's window, offering once it comes, or Chrome's menu once it is late", () => {
    const late = browser({ prompt: 'waiting' });
    render(<InstallOffer platform={late.platform} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wasInstallOffered()).toBe(false);
    late.set('available');
    expect(screen.getByRole('dialog', { name: offerTitle })).toBeDefined();
    cleanup();
    localStorage.clear();

    const never = browser({ prompt: 'waiting' });
    render(<InstallOffer platform={never.platform} />);
    never.set('absent');
    expect(screen.getByRole('dialog', { name: offerTitle })).toBeDefined();
  });

  it('takes another Chromium browser without a window for one that cannot install, and follows a window handed late', async () => {
    const user = userEvent.setup();
    const late = browser({ userAgent: samsung, prompt: 'waiting' });
    render(<InstallOffer platform={late.platform} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    late.set('absent');
    expect(screen.getByRole('dialog', { name: offerTitle })).toBeDefined();
    late.set('available');
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(screen.getByRole('heading', { name: 'Touche « Installer » ci-dessous' })).toBeDefined();
  });

  it('remembers « Plus tard »', async () => {
    const user = userEvent.setup();
    render(<InstallOffer platform={browser().platform} />);
    await user.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<InstallOffer platform={browser().platform} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers nothing, and keeps the offer to make, where no guide fits yet or nothing is to install', () => {
    const cases = [browser({ userAgent: inApp }), browser({ userAgent: windows }), browser({ standalone: true })];
    for (const { platform } of cases) {
      render(<InstallOffer platform={platform} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      cleanup();
    }
    expect(wasInstallOffered()).toBe(false);
  });
});

describe('other browsers of Android', () => {
  /** Puts a clipboard on the page that takes the text, or refuses it with `refuse`. */
  const clipboard = (refuse = false) => {
    const writeText = vi.fn(() => (refuse ? Promise.reject(new DOMException('Denied', 'NotAllowedError')) : Promise.resolve()));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  };
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it("walks Firefox through its ⋮ menu, « Plus » and the window of Android's home screen", async () => {
    const user = userEvent.setup();
    render(<InstallOffer title="Week-end" platform={browser({ userAgent: firefox, prompt: 'waiting' }).platform} />);
    // Firefox hands no window: its guide is known at once.
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    await walk(user, [
      ['Touche ⋮ en haut à droite', 'Plus'],
      ['Touche « Plus »', 'Plus'],
      ["Touche « Ajouter l'application à l'écran d'accueil »", "Ajouter l'application"],
      ["Touche « Ajouter » dans la fenêtre qui s'ouvre", 'Ajouter'],
      ["Touche l'icône La Pince sur ton écran d'accueil", 'Week-end'],
    ]);
    await user.click(screen.getByRole('button', { name: "J'ai compris" }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a browser cannot install, opens the page in Chrome or copies its link, and still walks through a shortcut', async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    render(<InstallOffer title="Week-end" platform={browser({ userAgent: samsung, prompt: 'absent' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(cannotTitle);
    expect(screen.getByText('La Pince recommande Chrome.')).toBeDefined();
    expect(screen.queryByText(/^Étape/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Ouvrir dans Chrome' }).getAttribute('href')).toMatch(
      /^intent:\/\/.+#Intent;scheme=https?;package=com\.android\.chrome;S\.browser_fallback_url=.+;end$/,
    );

    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    expect(writeText).toHaveBeenCalledWith(location.href);
    expect(await screen.findByRole('button', { name: 'Lien copié : colle-le dans Chrome' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Faire un raccourci quand même' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Faire un raccourci' }));
    await walk(user, [
      ['Touche ⋮ en haut à droite', "Ajouter à l'écran d'accueil"],
      ["Touche « Ajouter à l'écran d'accueil »", "Ajouter à l'écran d'accueil"],
      ['Touche « Ajouter »', 'Ajouter'],
    ]);
    expect(screen.getByRole('button', { name: "J'ai compris" })).toBeDefined();
    // Back to the first step, then to the word that it cannot install.
    await user.click(screen.getByRole('button', { name: 'Précédent' }));
    await user.click(screen.getByRole('button', { name: 'Précédent' }));
    await user.click(screen.getByRole('button', { name: 'Précédent' }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(cannotTitle);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: "Installer l'app" }));
    // Samsung Internet may have installed the app by its menu: where to find it is said.
    expect(screen.getByText("Déjà installée ? Ouvre La Pince depuis ton écran d'accueil.")).toBeDefined();
  });

  it('says so when the clipboard refuses the link', async () => {
    const user = userEvent.setup();
    clipboard(true);
    render(<InstallOffer platform={browser({ userAgent: oldAndroid }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    expect(await screen.findByRole('button', { name: "Copie impossible : copie l'adresse de la page depuis la barre du navigateur" })).toBeDefined();
    // A browser that is not Chromium installed nothing.
    expect(screen.queryByText("Déjà installée ? Ouvre La Pince depuis ton écran d'accueil.")).toBeNull();
  });
});

describe('guides of the iPhone', () => {
  const open = "Touche l'icône La Pince sur ton écran d'accueil";

  it('walks Safari before 26 through Share in its bottom bar', async () => {
    const user = userEvent.setup();
    render(<InstallOffer title="Week-end" platform={browser({ userAgent: safari18, prompt: 'absent' }).platform} />);
    expect(screen.getByRole('dialog', { name: offerTitle })).toBeDefined();
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(screen.getByText("Que l'adresse soit en haut ou en bas, Partager est dans la barre du bas.")).toBeDefined();
    await walk(user, [
      ["Touche l'icône Partager, en bas de l'écran", 'Week-end'],
      ["Fais défiler jusqu'à « Sur l'écran d'accueil »", "Sur l'écran d'accueil"],
      ["Touche « Sur l'écran d'accueil »"],
      // No switch to open as a web app before iOS 26.
      ['Touche « Ajouter » en haut à droite', 'Ajouter', 'Ouvrir comme app web'],
      [open],
    ]);
    await user.click(screen.getByRole('button', { name: "J'ai compris" }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks Safari 26 which bar it shows, the compact one first, and walks either', async () => {
    const user = userEvent.setup();
    render(<InstallOffer title="Week-end" platform={browser({ userAgent: safari26, prompt: 'absent' }).platform} />);
    await user.click(screen.getByRole('button', { name: "C'est parti" }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe("Qu'est-ce que tu vois en bas de ton écran ?");
    const compact = screen.getByRole('button', { name: 'Une barre avec «\u00a0…\u00a0»' });
    const bar = screen.getByRole('button', { name: 'Une barre avec Partager' });
    expect(compact.getAttribute('aria-pressed')).toBe('true');
    expect(bar.getAttribute('aria-pressed')).toBe('false');
    expect(step(1, 7)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await walk(
      user,
      [
        ['Touche «\u00a0…\u00a0» en bas à droite', 'Partager'],
        ['Touche « Partager »'],
        ["Fais défiler jusqu'à « Sur l'écran d'accueil »"],
        ["Touche « Sur l'écran d'accueil »"],
        ['Laisse « Ouvrir comme app web » activé, puis touche « Ajouter »', 'Ouvrir comme app web'],
        [open],
      ],
      2,
    );

    // Back to the choice, the other bar.
    for (let back = 0; back < 6; back += 1) {
      await user.click(screen.getByRole('button', { name: 'Précédent' }));
    }
    await user.click(screen.getByRole('button', { name: 'Une barre avec Partager' }));
    expect(screen.getByRole('button', { name: 'Une barre avec Partager' }).getAttribute('aria-pressed')).toBe('true');
    expect(step(1, 6)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await walk(
      user,
      [
        // Share in the bar: no menu of « … ».
        ["Touche l'icône Partager, en bas de l'écran", undefined, 'Partager'],
        ["Fais défiler jusqu'à « Sur l'écran d'accueil »"],
        ["Touche « Sur l'écran d'accueil »"],
        ['Laisse « Ouvrir comme app web » activé, puis touche « Ajouter »'],
        [open],
      ],
      2,
    );
  });

  it('walks Chrome on an iPhone, and the other browsers of the iPhone, through Share beside the address', async () => {
    const user = userEvent.setup();
    for (const userAgent of [chromeIos, firefoxIos]) {
      render(<InstallOffer platform={browser({ userAgent, prompt: 'absent' }).platform} />);
      await user.click(screen.getByRole('button', { name: "C'est parti" }));
      await walk(user, [
        ["Touche l'icône Partager, à droite de l'adresse"],
        ["Fais défiler jusqu'à « Ajouter à l'écran d'accueil »", "Ajouter à l'écran d'accueil"],
        ["Touche « Ajouter à l'écran d'accueil »"],
        ['Touche « Ajouter » en haut à droite'],
        [open],
      ]);
      expect(screen.getByRole('button', { name: "J'ai compris" })).toBeDefined();
      cleanup();
      localStorage.clear();
    }
  });

  it('opens the guide from a link as often as asked, without the offer, and shows no link where no guide fits', async () => {
    const user = userEvent.setup();
    render(<InstallGuideLink title="Week-end" label="Voir comment faire" platform={browser({ userAgent: safari18, prompt: 'absent' }).platform} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    for (let time = 0; time < 2; time += 1) {
      await user.click(screen.getByRole('button', { name: 'Voir comment faire' }));
      expect(screen.getByRole('dialog', { name: "Installer l'app" })).toBeDefined();
      expect(step(1, 5)).toBeDefined();
      await user.click(screen.getByRole('button', { name: 'Fermer le guide' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    // The link does not count as the offer, still to make.
    expect(wasInstallOffered()).toBe(false);
    cleanup();

    render(<InstallGuideLink title="Week-end" label="Voir comment faire" platform={browser({ userAgent: windows }).platform} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it("falls back on Chrome's menu from a link when the window cannot open", async () => {
    const user = userEvent.setup();
    render(<InstallGuideLink title="Week-end" label="Voir comment faire" platform={browser({ answer: 'unavailable' }).platform} />);
    await user.click(screen.getByRole('button', { name: 'Voir comment faire' }));
    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(await screen.findByRole('heading', { name: 'Touche ⋮ en haut à droite' })).toBeDefined();
    cleanup();

    render(
      <InstallGuideLink title="Week-end" label="Voir comment faire" platform={browser({ userAgent: samsung, answer: 'unavailable' }).platform} />,
    );
    await user.click(screen.getByRole('button', { name: 'Voir comment faire' }));
    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(await screen.findByRole('heading', { name: cannotTitle })).toBeDefined();
  });
});

describe('moment of the offer', () => {
  const token = 'demo-token-of-the-install-tests-01234567';
  const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });

  // An Android Chrome that hands its window, through the browser's own APIs.
  const onAndroidChrome = () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome);
    // Held from the start of the page, as `main.tsx` does.
    captureInstallPrompt();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  };

  it('comes over the group once who I am is told, the group behind', async () => {
    const user = userEvent.setup();
    renderApp(`/g/${token}`, fakeServer({ token, group }).fetch);
    await screen.findByRole('heading', { name: 'Qui es-tu ?' });
    onAndroidChrome();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Alice' }));
    expect(await screen.findByRole('dialog', { name: offerTitle })).toBeDefined();
    expect(screen.getByText('Tu es Alice')).toBeDefined();
    vi.restoreAllMocks();
  });

  it('waits for who I am to be asked again when the member remembered left the group', async () => {
    const user = userEvent.setup();
    await rememberMember(token, 'm9');
    onAndroidChrome();
    renderApp(`/g/${token}`, fakeServer({ token, group }).fetch);
    await screen.findByRole('heading', { name: 'Qui es-tu ?' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Alice' }));
    expect(await screen.findByRole('dialog', { name: offerTitle })).toBeDefined();
    vi.restoreAllMocks();
  });

  it('comes on the screen without a group too', async () => {
    onAndroidChrome();
    renderApp('/', fakeServer({ token, group }).fetch);
    expect(await screen.findByRole('dialog', { name: offerTitle })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Ouvre ton groupe' })).toBeDefined();
    vi.restoreAllMocks();
  });
});
