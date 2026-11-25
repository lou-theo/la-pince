import { groupResponseSchema } from '@la-pince/core';
import { cleanup, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import avatarStyles from './screens/Avatar.module.css';
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
    expect(screen.getAllByRole('link', { current: 'page' }).map((link) => link.textContent)).toStrictEqual(['BTu es Bruno']);
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

  // The texts of each row, without the avatar, which is not read.
  const rowsOf = (list: HTMLElement) =>
    within(list)
      .getAllByRole('listitem')
      .map((row) =>
        [...row.querySelectorAll('span')]
          .filter((span) => span.childElementCount === 0 && span.closest('[aria-hidden]') === null)
          .map((span) => span.textContent),
      );
  // The initial of each row's avatar, and whether it takes my color.
  const payerAvatarsOf = (list: HTMLElement) =>
    within(list)
      .getAllByRole('listitem')
      .map((row) => {
        const avatar = row.querySelector('[aria-hidden]');
        return [avatar?.textContent, avatar?.classList.contains(avatarStyles.me ?? '') ?? false];
      });

  it('lists the operations under their day, the latest first, each saying in words what it means for me', async () => {
    await openAsBruno();
    const days = screen.getAllByRole('heading', { level: 2 });
    // The year is said only for another year than today's.
    expect(days.map((day) => day.textContent.replace(/ 2026$/, ''))).toStrictEqual(['Samedi 7 novembre', 'Vendredi 6 novembre', 'Jeudi 5 novembre']);
    expect(screen.getAllByRole('list').flatMap(rowsOf)).toStrictEqual([
      ['Virement', 'Chloé a remboursé 5,00 € à\u00a0Alice', 'Pas concerné'],
      ['Péage', 'Tu as payé 7,00 €', 'Tu as avancé', '7,00 €'],
      ['Courses', 'Alice a payé 45,00 €', 'Tu dois', '20,00 €'],
    ]);
    expect(screen.getByRole('link', { name: 'Dépenses' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Ajouter une dépense' }).getAttribute('href')).toBe(`/g/${token}/nouvelle-depense`);
  });

  it('shows the avatar of who paid before the words, mine in my color, and keeps the one of a member gone from the list', async () => {
    await openAsBruno(
      `/g/${token}`,
      group.members.filter((member) => member.id !== 'm1'),
    );
    // Chloé reimbursing, me paying, then Alice, gone from the list, known by her identifier.
    expect(screen.getAllByRole('list').flatMap(payerAvatarsOf)).toStrictEqual([
      ['C', false],
      ['B', true],
      ['M', false],
    ]);
    // Out of what is read: the line says the same words as without it.
    expect(screen.getByRole('link', { name: /^Courses m1 a payé 45,00\s€ Tu dois 20,00\s€$/ })).toBeDefined();
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

  it('ranks the balances, the largest first, each line naming the member, where they stand and the amount', async () => {
    const { user, location } = await openAsBruno();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    expect(location.history.at(-1)).toBe(`/g/${token}/soldes`);
    expect(screen.getByRole('link', { name: 'Soldes' }).getAttribute('aria-current')).toBe('page');
    const balances = within(screen.getByRole('region', { name: 'Soldes' }));
    expect(balances.getAllByRole('link').map((line) => line.getAttribute('aria-label'))).toStrictEqual([
      'Alice, en positif, 23,00\u00a0€',
      'Chloé, doit, 10,00\u00a0€',
      'Bruno (toi), doit, 13,00\u00a0€',
    ]);
    // Who I am is “Toi” on screen, each amount unsigned beside its word.
    expect(balances.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual([
      'A€Aliceen positif23,00\u00a0€',
      'CChloédoit10,00\u00a0€',
      'BToidoit13,00\u00a0€',
    ]);
    expect(screen.getByText('Les rentiers')).toBeDefined();
    expect(screen.getByText('Au bagne')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Pour tout solder · 2 virements suggérés' }).getAttribute('href')).toBe(`/g/${token}/soldes/virements`);
    cleanup();
    // The same screen with a trailing slash keeps its tab.
    await openAsBruno(`/g/${token}/soldes/`);
    expect(screen.getByRole('link', { name: 'Soldes' }).getAttribute('aria-current')).toBe('page');
  });

  it('groups the transfers by who owes, the largest debt first, under the balances tab', async () => {
    const { user, location } = await openAsBruno(`/g/${token}/soldes`);
    await user.click(screen.getByRole('link', { name: /^Pour tout solder/ }));
    expect(location.history.at(-1)).toBe(`/g/${token}/soldes/virements`);
    expect(screen.getByRole('heading', { level: 1, name: 'Remboursements suggérés' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Soldes' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.getAttribute('aria-label'))).toStrictEqual([
      'Bruno (toi), doit, 13,00\u00a0€',
      'Chloé, doit, 10,00\u00a0€',
    ]);
    expect(screen.getAllByRole('button', { name: /^C'est payé/ }).map((button) => button.getAttribute('aria-label'))).toStrictEqual([
      "C'est payé : Bruno (toi) doit 13,00\u00a0€ à Alice",
      "C'est payé : Chloé doit 10,00\u00a0€ à Alice",
    ]);
    expect(screen.getByRole('link', { name: 'Déclarer un autre remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?retour=%2Fsoldes%2Fvirements`,
    );
    expect(screen.getByText(/^Dernière synchro à \d\d:\d\d\.$/)).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    expect(location.history.at(-1)).toBe(`/g/${token}/soldes`);
  });

  it("opens a member's sheet from the ranking: who owes them, or what they owe, in my words on mine", async () => {
    const { user, location } = await openAsBruno(`/g/${token}/soldes`);
    await user.click(screen.getByRole('link', { name: /^Alice,/ }));
    expect(location.history.at(-1)).toBe(`/g/${token}/soldes/membres/m1`);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Alice');
    expect(screen.getByText(/^en positif de/).textContent).toBe('en positif de 23,00\u00a0€');
    const owed = within(screen.getByRole('region', { name: 'Lui doivent' }));
    expect(owed.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual([
      "BToi13,00\u00a0€C'est payé",
      "CChloé10,00\u00a0€C'est payé",
    ]);
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?a=m1&retour=%2Fsoldes%2Fmembres%2Fm1`,
    );
    expect(screen.getByText('Remboursements suggérés pour que tout le groupe soit à jour.')).toBeDefined();
    expect(screen.getByText(/^Dernière synchro à \d\d:\d\d\.$/)).toBeDefined();

    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    await user.click(screen.getByRole('link', { name: /^Bruno \(toi\),/ }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Bruno (toi)');
    expect(screen.getByText(/^Tu dois/).textContent).toBe('Tu dois 13,00\u00a0€');
    const mine = within(screen.getByRole('region', { name: 'Tes remboursements à faire' }));
    expect(mine.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual(["Aà Alice13,00\u00a0€C'est payé"]);
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?de=m2&retour=%2Fsoldes%2Fmembres%2Fm2`,
    );

    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    await user.click(screen.getByRole('link', { name: /^Chloé,/ }));
    expect(screen.getByRole('region', { name: 'Ses remboursements à faire' }).textContent).toContain('à Alice');
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?de=m3&retour=%2Fsoldes%2Fmembres%2Fm3`,
    );
  });

  it('declares as the receiver when the group owes me, and nothing for a member who left the group', async () => {
    const user = userEvent.setup();
    await rememberMember(token, 'm2');
    // Bruno paid 5,00 € for Alice; a member who left paid 3,00 € for Chloé.
    const owedToMe = [
      change({ id: 'op-mine', date: '2026-11-02', payer: 'm2', lines: [['m1', 500]] }),
      change({ id: 'op-left', date: '2026-11-03', payer: 'gone', lines: [['m3', 300]] }),
      change({ id: 'op-left-owes', date: '2026-11-04', payer: 'm1', lines: [['gone-too', 100]] }),
    ];
    renderApp(`/g/${token}/soldes`, fakeServer({ token, group, changes: owedToMe }).fetch);
    await user.click(await screen.findByRole('link', { name: /^Bruno \(toi\), en positif/ }));
    expect(screen.getByText(/^Tu es en positif de/).textContent).toBe('Tu es en positif de 5,00 €');
    expect(screen.getByRole('region', { name: 'Te doivent' }).textContent).toContain('Alice');
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?a=m2&retour=%2Fsoldes%2Fmembres%2Fm2`,
    );
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    await user.click(screen.getByRole('link', { name: 'gone, en positif, 3,00\u00a0€' }));
    // The reimbursement page does not offer them: the server would refuse a reimbursement naming them.
    expect(screen.queryByRole('link', { name: 'Déclarer un remboursement' })).toBeNull();
    // Chloé's transfer to them is shown, without “C'est payé”, which the server would refuse.
    expect(screen.getByRole('region', { name: 'Lui doivent' }).textContent).toBe('Lui doiventCChloé3,00\u00a0€');
    // Nor on the transfer of a member who left and owes.
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    await user.click(screen.getByRole('link', { name: 'gone-too, doit, 1,00\u00a0€' }));
    expect(screen.getByRole('region', { name: 'Ses remboursements à faire' }).textContent).toBe('Ses remboursements à faireBà toi1,00\u00a0€');
  });

  it('says so for a member who is not in the group', async () => {
    await rememberMember(token, 'm2');
    for (const id of ['nobody', 'not%20an%20id']) {
      renderApp(`/g/${token}/soldes/membres/${id}`, fakeServer({ token, group, changes }).fetch);
      expect(await screen.findByText("Ce membre n'est pas dans le groupe.")).toBeDefined();
      expect(screen.getByRole('link', { name: 'Retour aux soldes' })).toBeDefined();
      cleanup();
    }
    // An unknown path under the balances keeps the group's band, a way out included.
    renderApp(`/g/${token}/soldes/membres`, fakeServer({ token, group, changes }).fetch);
    expect(await screen.findByText('Tu es Bruno')).toBeDefined();
  });

  it('tells an empty group, settled', async () => {
    const user = userEvent.setup();
    await rememberMember(token, 'm2');
    renderApp(`/g/${token}`);
    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    // Neither banners nor amounts, and no transfers to open.
    const balances = within(screen.getByRole('region', { name: 'Soldes' }));
    expect(balances.getAllByRole('link').map((line) => line.getAttribute('aria-label'))).toStrictEqual([
      'Alice, à jour',
      'Bruno (toi), à jour',
      'Chloé, à jour',
    ]);
    expect(screen.queryByText('Les rentiers')).toBeNull();
    expect(screen.queryByText('Au bagne')).toBeNull();
    expect(screen.getByText('Tout le monde est à jour').tagName).toBe('P');
    await user.click(screen.getByRole('link', { name: 'Chloé, à jour' }));
    expect(screen.getByText('À jour')).toBeDefined();
    expect(screen.getByText('Aucun remboursement à faire ni à recevoir.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Déclarer un remboursement' }).getAttribute('href')).toBe(
      `/g/${token}/nouveau-remboursement?de=m3&retour=%2Fsoldes%2Fmembres%2Fm3`,
    );
    cleanup();
    renderApp(`/g/${token}/soldes/virements`);
    expect(await screen.findByText('Tout le monde est à jour : aucun remboursement à faire.')).toBeDefined();
  });
});
