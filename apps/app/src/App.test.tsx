import { type ApiError, groupResponseSchema } from '@la-pince/core';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from './App.tsx';
import { createApiClient, type Fetch } from './sync/client.ts';

const token = 'demo-token-of-the-app-tests-0123456789';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
    { id: 'm3', name: 'Chloé' },
  ],
});

// Fake transport: the server's answers, built through the schemas of the core.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const server: Fetch = (url) =>
  Promise.resolve(url === `/api/groups/${token}` ? json(group) : json({ error: 'group_not_found' } satisfies ApiError, 404));

function renderApp(path: string, fetchFn: Fetch = server) {
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook}>
      <App client={createApiClient(fetchFn)} />
    </Router>,
  );
  return location;
}

describe('opening a group', () => {
  it('asks who I am, remembers it on this phone, and lets me change', async () => {
    const user = userEvent.setup();
    renderApp(`/g/${token}`);
    expect(screen.getByRole('status').textContent).toBe('Chargement du groupe…');
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual(['Alice', 'Bruno', 'Chloé']);

    await user.click(screen.getByRole('button', { name: 'Bruno' }));
    expect(screen.getByRole('heading', { name: 'Week-end' })).toBeDefined();
    expect(screen.getByText('Tu es Bruno')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Changer' }));
    expect(screen.getByRole('button', { name: 'Bruno' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Chloé' }));
    expect(screen.getByText('Tu es Chloé')).toBeDefined();
  });

  it('opens straight on the group once I said who I am, and asks again if that member is no longer in the group', async () => {
    const user = userEvent.setup();
    renderApp(`/g/${token}`);
    await user.click(await screen.findByRole('button', { name: 'Alice' }));
    cleanup();

    renderApp(`/g/${token}`);
    expect(await screen.findByText('Tu es Alice')).toBeDefined();

    const withoutAlice = groupResponseSchema.parse({ ...group, members: group.members.slice(1) });
    renderApp(`/g/${token}`, () => Promise.resolve(json(withoutAlice)));
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
  });

  it('tells an unknown group, and offers to paste another link', async () => {
    const user = userEvent.setup();
    const location = renderApp(`/g/${'u'.repeat(40)}`);
    expect((await screen.findByRole('alert')).textContent).toBe("Ce groupe n'existe pas, ou son lien a changé : demande le nouveau lien au groupe.");
    await user.click(screen.getByRole('link', { name: 'Ouvrir un autre lien' }));
    expect(location.history.at(-1)).toBe('/lien');
  });

  it('tells a server out of reach, and reads the group again on retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderApp(`/g/${token}`, (url, init) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new TypeError('Failed to fetch')) : server(url, init);
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
  });

  it('tells an answer outside the contract, and offers to retry', async () => {
    renderApp(`/g/${token}`, () => Promise.resolve(json({ title: 'Week-end', members: [] })));
    expect((await screen.findByRole('alert')).textContent).toBe('Le serveur a répondu de façon inattendue : réessaie plus tard.');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });

  it('drops the answer of a group left before it arrived', async () => {
    let answer: (response: Response) => void = () => undefined;
    renderApp(`/g/${token}`, () => new Promise((resolve) => (answer = resolve)));
    cleanup();
    answer(json(group));
    await Promise.resolve();
    expect(localStorage.getItem('la-pince:last-group')).toBeNull();
  });

  it('tells a malformed link without calling the server', () => {
    renderApp('/g/short', () => Promise.reject(new Error('the server is not called')));
    expect(screen.getByText('Ce lien est incomplet ou mal recopié.')).toBeDefined();
  });
});

describe('without a link', () => {
  it('opens the group of a pasted link, after refusing a text that holds none', async () => {
    const user = userEvent.setup();
    const location = renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByRole('alert').textContent).toBe("Ce lien n'est pas celui d'un groupe La Pince.");
    expect(screen.getByLabelText('Lien du groupe').getAttribute('aria-invalid')).toBe('true');

    await user.type(screen.getByLabelText('Lien du groupe'), `https://la-pince.example/g/${token}`);
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(location.history.at(-1)).toBe(`/g/${token}`);
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
  });

  it('goes back to the last group opened on this phone', async () => {
    renderApp(`/g/${token}`);
    await screen.findByRole('heading', { name: 'Qui es-tu ?' });
    cleanup();

    const location = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
    expect(location.history.at(-1)).toBe(`/g/${token}`);
  });

  it('says so for an unknown page', () => {
    renderApp('/nowhere');
    expect(screen.getByText("Cette page n'existe pas.")).toBeDefined();
  });
});
