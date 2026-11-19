import { groupResponseSchema } from '@la-pince/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServer } from '../testing/fake-server.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { renderApp } from '../testing/render.tsx';

const token = 'demo-token-of-the-share-tests-0123456789';
const group = groupResponseSchema.parse({ title: 'Week-end', members: [{ id: 'm1', name: 'Alice' }] });
const link = `${window.location.origin}/g/${token}`;

/** Replaces what the browser offers for sharing, `undefined` standing for a browser without it. */
function browserOffers({ share, writeText }: { share?: (data: ShareData) => Promise<void>; writeText?: (text: string) => Promise<void> }) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
}

/** Opens the group as Alice, from one of its pages, and presses the share button. */
async function openAndShare(path = '') {
  await rememberMember(token, 'm1');
  renderApp(`/g/${token}${path}`, fakeServer({ token, group }).fetch);
  fireEvent.click(await screen.findByRole('button', { name: 'Partager le lien du groupe' }));
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('sharing the group link', () => {
  it("opens the phone's share sheet with the group's link, from any page of the group", async () => {
    const sheet = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    browserOffers({ share: sheet, writeText });
    await openAndShare('/soldes');
    await waitFor(() => {
      expect(sheet).toHaveBeenCalledWith({ title: 'Week-end', text: 'Le groupe « Week-end » sur La Pince :', url: link });
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText(/Lien copié/)).toBeNull();
  });

  it('does nothing more when the sheet is closed without sharing', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const closed = vi.fn<(data: ShareData) => Promise<void>>().mockRejectedValue(new DOMException('closed', 'AbortError'));
    browserOffers({ share: closed, writeText });
    await openAndShare();
    await waitFor(() => {
      expect(closed).toHaveBeenCalled();
    });
    // Lets the refused promise settle before checking that nothing followed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('copies the link when the browser has no share sheet, or refuses it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    browserOffers({ share: () => Promise.reject(new DOMException('no gesture', 'NotAllowedError')), writeText });
    await openAndShare();
    expect(await screen.findByText('Lien copié : colle-le à qui doit rejoindre le groupe.')).toBeDefined();
    expect(writeText).toHaveBeenCalledWith(link);
  });

  it('shows the link to copy by hand when the clipboard is out of reach too', async () => {
    browserOffers({});
    await openAndShare();
    const field = await screen.findByRole('textbox', { name: 'Copie ce lien et envoie-le à qui doit rejoindre le groupe :' });
    expect((field as HTMLInputElement).value).toBe(link);
  });
});
