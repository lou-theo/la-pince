import { groupResponseSchema } from '@la-pince/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { captureInstallPrompt, type InstallOutcome, type InstallPlatform } from '../install/platform.ts';
import type { PromptState } from '../model/install.ts';
import { wasInstallOffered } from '../storage/device.ts';
import { fakeServer } from '../testing/fake-server.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { renderApp } from '../testing/render.tsx';
import { InstallOffer } from './InstallOffer.tsx';

const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const samsung = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
const step = (number: number, total: number) => screen.getByText(`Étape ${String(number)} sur ${String(total)}`);

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
    expect(step(1, 3)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Touche « Installer » ci-dessous' })).toBeDefined();
    // The phone drawn shows the group and the address of the app.
    expect(screen.getByText('Week-end', { selector: 'text' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Précédent' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Installer' }));
    expect(state.installs).toBe(1);
    expect(await screen.findByRole('heading', { name: "C'est installé : touche l'icône La Pince sur ton écran d'accueil" })).toBeDefined();
    expect(step(3, 3)).toBeDefined();

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

  it("goes through Chrome's menu when the window cannot open, and closes elsewhere", async () => {
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
    await act(() => Promise.resolve());
    expect(screen.queryByRole('dialog')).toBeNull();
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
    const cases = [
      browser({ userAgent: samsung, prompt: 'absent' }),
      browser({ userAgent: iphone }),
      browser({ userAgent: windows }),
      browser({ standalone: true }),
    ];
    for (const { platform } of cases) {
      render(<InstallOffer platform={platform} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      cleanup();
    }
    expect(wasInstallOffered()).toBe(false);
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
