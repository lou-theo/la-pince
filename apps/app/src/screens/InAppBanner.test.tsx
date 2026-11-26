import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InstallPlatform } from '../install/platform.ts';
import { InAppBanner } from './InAppBanner.tsx';

const token = 'demo-token-of-the-banner-tests-012345678';
const instagram =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 356.0.0.41.101 Android (34/14; 420dpi)';
const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const platformOf = (userAgent: string): InstallPlatform => ({
  environment: () => ({ userAgent, maxTouchPoints: 5, standalone: false }),
  prompt: () => 'absent',
  onPromptChange: () => () => undefined,
  install: () => Promise.resolve('unavailable'),
});

function clipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

const banner = () => screen.queryByRole('complementary', { name: "Installer l'app" });

describe('banner of a browser built into an app', () => {
  it('copies the link of the group, to paste in the browser', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    render(<InAppBanner token={token} platform={platformOf(instagram)} />);
    expect(screen.getByText("Pour installer l'app, ouvre ce lien dans ton navigateur")).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/g/${token}`);
    expect(screen.getByText('Colle le lien dans ton navigateur')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Lien copié' })).toBeDefined();
  });

  it('shows the link to copy by hand where the clipboard is refused', async () => {
    const user = userEvent.setup();
    clipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    render(<InAppBanner token={token} platform={platformOf(instagram)} />);
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Copie ce lien et colle-le dans ton navigateur :' });
    expect(input.value).toBe(`${location.origin}/g/${token}`);
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).toBeNull();
  });

  it('hides on demand for the session, and comes back with a new one', async () => {
    const user = userEvent.setup();
    render(<InAppBanner token={token} platform={platformOf(instagram)} />);
    await user.click(screen.getByRole('button', { name: 'Masquer ce message' }));
    expect(banner()).toBeNull();
    cleanup();
    render(<InAppBanner token={token} platform={platformOf(instagram)} />);
    expect(banner()).toBeNull();
    cleanup();
    sessionStorage.clear();
    render(<InAppBanner token={token} platform={platformOf(instagram)} />);
    expect(banner()).not.toBeNull();
  });

  it('shows nothing in a browser that installs', () => {
    render(<InAppBanner token={token} platform={platformOf(chrome)} />);
    expect(banner()).toBeNull();
  });
});
