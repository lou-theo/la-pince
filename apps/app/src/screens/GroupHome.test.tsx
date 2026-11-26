import { groupResponseSchema } from '@la-pince/core';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { rememberInstallOffered } from '../storage/device.ts';
import { change, fakeServer, json } from '../testing/fake-server.ts';
import { rememberMember } from '../testing/groupDb.ts';
import { renderApp } from '../testing/render.tsx';

const token = 'demo-token-of-the-group-home-tests-01234';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
  ],
});
const keyUrl = '/api/notifications/key';

describe('frame of a group', () => {
  it('checks the notifications at every opening, on the list too, shows them with who I am only, and closes their guide when left', async () => {
    // An iPhone, whose browser has no Push API in a tab: the notifications ask for the home screen, after reading the instance's key.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    );
    await rememberMember(token, 'm2');
    // The offer made already, so that only the guide of the notifications opens.
    rememberInstallOffered();
    const server = fakeServer({
      token,
      group,
      answer: (url) => (url === keyUrl ? Promise.resolve(json({ publicKey: `B${'k'.repeat(86)}` })) : undefined),
    });
    const user = userEvent.setup();
    const location = renderApp(`/g/${token}`, server.fetch);
    await waitFor(() => {
      expect(server.calls).toContain(keyUrl);
    });
    const homeScreen = /ajoute d'abord La Pince à l'écran d'accueil/;
    expect((await screen.findByText(homeScreen)).closest('[hidden]')).not.toBeNull();

    await user.click(screen.getByRole('link', { name: 'Tu es Bruno' }));
    expect(screen.getByText(homeScreen).closest('[hidden]')).toBeNull();

    // Left by the back gesture, the guide open: the notifications stay mounted, hidden, and their guide must not stay modal over the list.
    await user.click(screen.getByRole('button', { name: 'Voir comment faire' }));
    expect(screen.getByRole('dialog', { name: "Installer l'app" })).toBeDefined();
    act(() => {
      location.navigate(`/g/${token}`);
    });
    expect(screen.getByText(homeScreen).closest('[hidden]')).not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('dialog[open]')).toBeNull();
    });
    vi.restoreAllMocks();
  });

  it('hides the menu on the forms, which take the whole screen, and keeps it elsewhere', async () => {
    await rememberMember(token, 'm2');
    const server = fakeServer({ token, group, changes: [change({ id: 'op-1', date: '2026-11-05', payer: 'm1', lines: [['m2', 500]] })] });
    for (const path of ['/nouvelle-depense', '/nouveau-remboursement/', '/operations/op-1/modifier']) {
      renderApp(`/g/${token}${path}`, server.fetch);
      // The band of a form holds its own bar, the way out first.
      await screen.findByRole('button', { name: 'Fermer' });
      expect(screen.queryByText('Tu es Bruno')).toBeNull();
      expect(screen.queryByRole('navigation')).toBeNull();
      cleanup();
    }
    renderApp(`/g/${token}/operations/op-1`, server.fetch);
    await screen.findByText('Tu es Bruno');
    expect(screen.getByRole('link', { name: 'Dépenses' }).getAttribute('aria-current')).toBe('page');
  });
});
