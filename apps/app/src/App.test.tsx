import { groupResponseSchema } from '@la-pince/core';
import { cleanup, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Fetch } from './sync/client.ts';
import { change, fakeServer, json } from './testing/fake-server.ts';
import { rememberMember } from './testing/groupDb.ts';
import { renderApp as renderWith } from './testing/render.tsx';

const token = 'demo-token-of-the-app-tests-0123456789';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
    { id: 'm3', name: 'Chloé' },
  ],
});

const server = fakeServer({ token, group }).fetch;

const renderApp = (path: string, fetchFn: Fetch = server) => renderWith(path, fetchFn);

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

    // The avatar of the band leads to who I am, outside both tabs.
    await user.click(screen.getByRole('link', { name: 'Tu es Bruno' }));
    expect(screen.getByRole('heading', { name: 'Tu es Bruno' })).toBeDefined();
    expect(screen.queryAllByRole('link', { current: 'page' })).toStrictEqual([]);
    await user.click(screen.getByRole('button', { name: "Ce n'est pas moi" }));
    expect(screen.getByRole('button', { name: 'Bruno' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Chloé' }));
    expect(screen.getByRole('heading', { name: 'Tu es Chloé' })).toBeDefined();
  });

  it('opens straight on the group once I said who I am, and asks again if that member is no longer in the group', async () => {
    const user = userEvent.setup();
    renderApp(`/g/${token}`);
    await user.click(await screen.findByRole('button', { name: 'Alice' }));
    cleanup();

    renderApp(`/g/${token}`);
    expect(await screen.findByText('Tu es Alice')).toBeDefined();

    const withoutAlice = groupResponseSchema.parse({ ...group, members: group.members.slice(1) });
    renderApp(`/g/${token}`, fakeServer({ token, group: withoutAlice }).fetch);
    expect(await screen.findByRole('heading', { name: 'Qui es-tu ?' })).toBeDefined();
  });

  it('opens without network on the copy kept from the last visit, saying when it was last synced', async () => {
    const user = userEvent.setup();
    renderApp(`/g/${token}`);
    await user.click(await screen.findByRole('button', { name: 'Chloé' }));
    cleanup();

    const location = renderApp('/', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await screen.findByText('Tu es Chloé')).toBeDefined();
    expect(location.history.at(-1)).toBe(`/g/${token}`);
    // Nothing waits to be sent: no promise about it.
    expect((await screen.findByRole('status')).textContent).toMatch(/^Hors ligne, dernière synchro à \d\d:\d\d\.Réessayer$/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells an unknown group, and offers to paste another link', async () => {
    const user = userEvent.setup();
    const location = renderApp(`/g/${'u'.repeat(40)}`);
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Ce groupe n'existe pas, ou son lien a changé : demande le nouveau lien à un membre du groupe.",
    );
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

  it('remembers nothing of a group left before its read ended', async () => {
    // The server answers every call, group and changes, only once the screen is gone.
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    renderApp(`/g/${token}`, (url, init) => gate.then(() => server(url, init)));
    cleanup();
    open();
    // A macrotask: both answers and their `then()` run before it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(localStorage.getItem('la-pince:last-group')).toBeNull();
  });

  it('tells a malformed link without calling the server', () => {
    const calls: string[] = [];
    renderApp('/g/short', (url) => {
      calls.push(url);
      return new Promise(() => undefined);
    });
    expect(screen.getByText('Ce lien est incomplet ou mal recopié.')).toBeDefined();
    expect(calls).toStrictEqual([]);
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

describe('a group as one of its members', () => {
  // Bruno pays the toll for Alice only, Alice the shopping for all three, Chloé pays Alice back; one operation was deleted.
  const changes = [
    change({
      id: 'op-shopping',
      date: '2026-11-05',
      title: 'Courses',
      payer: 'm1',
      lines: [
        ['m1', 1_000],
        ['m2', 2_000],
        ['m3', 1_500],
      ],
      author: 'm1',
    }),
    change({ id: 'op-toll', date: '2026-11-06', title: 'Péage', payer: 'm2', lines: [['m1', 700]] }),
    change({ id: 'op-payback', date: '2026-11-07', title: 'Virement', payer: 'm3', lines: [['m1', 500]], kind: 'reimbursement' }),
    change({ id: 'op-gone', date: '2026-11-08', title: 'Doublon', payer: 'm2', lines: [['m2', 900]] }),
    change({ id: 'op-gone', date: '2026-11-08', deleted: true }),
  ];

  async function openAsBruno(path = `/g/${token}`, members = group.members) {
    const user = userEvent.setup();
    await rememberMember(token, 'm2');
    const location = renderApp(path, fakeServer({ token, group: { ...group, members }, changes, pageSize: 2 }).fetch);
    await screen.findByText('Tu es Bruno');
    return { user, location };
  }

  const rowsOf = (list: HTMLElement) =>
    within(list)
      .getAllByRole('listitem')
      .map((row) => [...row.querySelectorAll('span span')].map((span) => span.textContent));

  it('lists the operations under their day, the latest first, each saying in words what it means for me', async () => {
    await openAsBruno();
    const days = screen.getAllByRole('heading', { level: 2 });
    // The year is said only for another year than today's.
    expect(days.map((day) => day.textContent.replace(/ 2026$/, ''))).toStrictEqual(['Samedi 7 novembre', 'Vendredi 6 novembre', 'Jeudi 5 novembre']);
    expect(screen.getAllByRole('list').flatMap(rowsOf)).toStrictEqual([
      ['Virement', 'Chloé a remboursé 5,00 € à Alice', 'Pas concerné'],
      ['Péage', 'Tu as payé 7,00 €', 'Tu as avancé', '7,00 €'],
      ['Courses', 'Alice a payé 45,00 €', 'Tu dois', '20,00 €'],
    ]);
    expect(screen.getByRole('link', { name: 'Dépenses' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Ajouter une dépense' }).getAttribute('href')).toBe(`/g/${token}/nouvelle-depense`);
  });

  it('says who reimbursed whom, “you” standing for who I am', async () => {
    await rememberMember(token, 'm2');
    const reimbursements = [
      change({ id: 'r-sent', date: '2026-11-07', title: 'Rendu', payer: 'm2', lines: [['m1', 500]], kind: 'reimbursement' }),
      change({ id: 'r-received', date: '2026-11-07', title: 'Reçu de Chloé', payer: 'm3', lines: [['m2', 300]], kind: 'reimbursement' }),
      change({
        id: 'r-several',
        date: '2026-11-07',
        title: 'Partagé',
        payer: 'm3',
        lines: [
          ['m1', 400],
          ['m2', 200],
        ],
        kind: 'reimbursement',
      }),
      change({ id: 'own', date: '2026-11-07', title: 'Pour moi', payer: 'm2', lines: [['m2', 900]] }),
    ];
    renderApp(`/g/${token}`, fakeServer({ token, group, changes: reimbursements }).fetch);
    await screen.findByText('Tu es Bruno');
    expect(rowsOf(screen.getByRole('list'))).toStrictEqual([
      ['Pour moi', 'Tu as payé 9,00 €', 'Ta part', '9,00 €'],
      ['Partagé', 'Chloé a remboursé Alice, Bruno (toi)', 'Reçu', '2,00 €'],
      ['Reçu de Chloé', "Chloé t'a remboursé", 'Reçu', '3,00 €'],
      ['Rendu', 'Tu as remboursé Alice', 'Versé', '5,00 €'],
    ]);
  });

  it('shows an operation with the share of each member, in the order they were added', async () => {
    // Members added in another order than their identifiers, which order the shares of an effect.
    const { user, location } = await openAsBruno(`/g/${token}`, group.members.toReversed());
    await user.click(screen.getByRole('link', { name: /Courses/ }));
    expect(location.history.at(-1)).toBe(`/g/${token}/operations/op-shopping`);
    expect(screen.getByRole('heading', { name: 'Courses' })).toBeDefined();
    expect(screen.getByText('jeudi 5 novembre 2026')).toBeDefined();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Montant 45,00\u00a0€')).toBeDefined();
    expect(screen.getByText('Payé par Alice')).toBeDefined();
    expect(screen.getByText('Saisi par Alice')).toBeDefined();
    const split = within(screen.getByRole('region', { name: 'Répartition' }));
    expect(split.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual([
      'Chloé15,00\u00a0€',
      'Bruno (toi)20,00\u00a0€',
      'Alice10,00\u00a0€',
    ]);
    // The detail belongs to the list of operations.
    expect(screen.getByRole('link', { name: 'Dépenses' }).getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('link', { name: 'Retour aux dépenses' }));
    expect(location.history.at(-1)).toBe(`/g/${token}/`);
  });

  it('shows a reimbursement without a split', async () => {
    await openAsBruno(`/g/${token}/operations/op-payback`);
    expect(screen.getByText('Chloé a remboursé Alice')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Répartition' })).toBeNull();
  });

  it('shows the split of a reimbursement to several members', async () => {
    await rememberMember(token, 'm2');
    const split = change({
      id: 'op-split',
      date: '2026-11-07',
      payer: 'm2',
      lines: [
        ['m1', 300],
        ['m3', 200],
      ],
      kind: 'reimbursement',
    });
    // Chloé added before Alice: both the title line and the split follow the group's order.
    const members = group.members.toReversed();
    renderApp(`/g/${token}/operations/op-split`, fakeServer({ token, group: { ...group, members }, changes: [split] }).fetch);
    expect(await screen.findByText('Bruno (toi) a remboursé Chloé, Alice')).toBeDefined();
    const lines = within(screen.getByRole('region', { name: 'Répartition' }));
    expect(lines.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual(['Chloé2,00\u00a0€', 'Alice3,00\u00a0€']);
  });

  it('says so for a deleted or unknown operation', async () => {
    await openAsBruno(`/g/${token}/operations/op-gone`);
    expect(screen.getByText("Cette dépense n'existe pas, ou elle a été supprimée.")).toBeDefined();
    cleanup();
    await openAsBruno(`/g/${token}/operations/op-nowhere`);
    expect(screen.getByText("Cette dépense n'existe pas, ou elle a été supprimée.")).toBeDefined();
  });

  it('shows the balances, the largest first, and the transfers that settle them', async () => {
    const { user, location } = await openAsBruno();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    expect(location.history.at(-1)).toBe(`/g/${token}/soldes`);
    expect(screen.getByRole('link', { name: 'Soldes' }).getAttribute('aria-current')).toBe('page');
    const balances = within(screen.getByRole('region', { name: 'Soldes' }));
    expect(balances.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual([
      'Alice+23,00\u00a0€',
      'Chloé-10,00\u00a0€',
      'Bruno (toi)-13,00\u00a0€',
    ]);
    cleanup();
    // The same screen with a trailing slash keeps its tab.
    await openAsBruno(`/g/${token}/soldes/`);
    expect(screen.getByRole('link', { name: 'Soldes' }).getAttribute('aria-current')).toBe('page');
    const transfers = within(screen.getByRole('region', { name: 'Remboursements suggérés' }));
    expect(transfers.getAllByRole('listitem').map((line) => line.firstChild?.textContent)).toStrictEqual([
      'Chloé doit 10,00\u00a0€ à Alice',
      'Bruno (toi) doit 13,00\u00a0€ à Alice',
    ]);
  });

  it('tells an empty group, settled', async () => {
    const user = userEvent.setup();
    await rememberMember(token, 'm2');
    renderApp(`/g/${token}`);
    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    expect(screen.getByText("Tout le monde est à l'équilibre.")).toBeDefined();
  });
});
