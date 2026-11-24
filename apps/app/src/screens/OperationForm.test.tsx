import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { openAsBruno as openGroup } from '../testing/group.ts';

const token = 'demo-token-of-the-form-tests-0123456789';
const nbsp = ' ';
const euros = (amount: string) => `${amount}${nbsp}€`;
// `getByText` collapses the spaces of the page, no-break ones included, but not those of the text looked for.
const shown = (text: string) => text.replace(/\s+/g, ' ');

const openAsBruno = (path = '', options: Parameters<typeof openGroup>[2] = {}) => openGroup(token, path, options);

const field = (name: string) => screen.getByLabelText(name);
const member = (name: string) => screen.getByRole('button', { name });
const value = (name: string) => (field(name) as HTMLInputElement).value;
const at = (location: { history: readonly string[] }) => location.history.at(-1)?.replace(`/g/${token}`, '');

describe('adding an expense', () => {
  it('opens for me alone, splits it equally between the members chosen, says each share, and opens it once saved', async () => {
    const { user, location, posted } = await openAsBruno();
    await user.click(screen.getByRole('link', { name: 'Ajouter une dépense' }));
    expect(screen.getByRole('heading', { name: 'Nouvelle dépense' })).toBeDefined();
    // Who I am first, as payer and in the grid, short.
    expect(
      within(field('Payé par'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toStrictEqual(['Toi', 'Alice', 'Chloé']);
    expect(screen.getAllByRole('button', { pressed: true }).map((button) => button.getAttribute('aria-label'))).toStrictEqual(['Bruno (toi)']);
    expect(screen.getByText('Pour qui · 1 sur 3')).toBeDefined();
    expect(screen.getByText('aujourd’hui')).toBeDefined();

    await user.type(field('Quoi'), 'Péage');
    await user.type(field('Montant'), '10');
    expect(screen.getByText(shown(euros('10,00') + ' chacun'))).toBeDefined();
    fireEvent.change(field('Quand'), { target: { value: '2026-11-08' } });
    expect(screen.getByText('8 nov.')).toBeDefined();
    await user.click(member('Alice'));
    expect(member('Alice').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(shown(euros('5,00') + ' chacun'))).toBeDefined();
    await user.click(member('Chloé'));
    expect(screen.getByText(shown(`3,33 ou ${euros('3,34')}`))).toBeDefined();
    await user.click(member('Chloé'));

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('heading', { name: 'Péage' })).toBeDefined();
    expect(at(location)).toMatch(/^\/operations\/[0-9a-f-]{36}$/);
    expect(screen.getByText('dimanche 8 novembre 2026')).toBeDefined();
    expect(screen.getByText('Saisi par Bruno (toi)')).toBeDefined();
    // Sent by the outbox once queued.
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted).toMatchObject([
      {
        title: 'Péage',
        date: '2026-11-08',
        author: 'm2',
        entry: {
          kind: 'expense',
          payer: 'm2',
          total: 1_000,
          lines: [
            { member: 'm2', weight: 1 },
            { member: 'm1', weight: 1 },
          ],
        },
      },
    ]);
  });

  it('greys its button while something is missing, and tells what at the first touch', async () => {
    const { user, location, posted } = await openAsBruno('/nouvelle-depense');
    expect(screen.getByRole('button', { name: 'Ajouter' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Personne' }));
    expect(screen.getByText('Pour qui · 0 sur 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText('Donne un titre.')).toBeDefined();
    expect(screen.getByText('Indique le montant.')).toBeDefined();
    expect(screen.getByText('Choisis au moins un membre.')).toBeDefined();
    expect(field('Quoi').getAttribute('aria-invalid')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Tous' }));
    expect(screen.getByText('Pour qui · 3 sur 3')).toBeDefined();
    expect(screen.queryByText('Choisis au moins un membre.')).toBeNull();
    await user.type(field('Quoi'), 'Péage');
    await user.type(field('Montant'), '9');
    expect(screen.getByRole('button', { name: 'Ajouter' }).getAttribute('aria-disabled')).toBe('false');
    expect(posted).toStrictEqual([]);
    expect(at(location)).toBe('/nouvelle-depense');
  });

  it('splits it by amounts, one line for each member chosen, checked against a control total', async () => {
    const { user, posted } = await openAsBruno('/nouvelle-depense');
    await user.type(field('Quoi'), 'Restaurant');
    await user.selectOptions(field('Répartition'), 'montants');
    await user.selectOptions(field('Payé par'), 'Alice');
    // The members not chosen are offered below the lines; nothing to say of the total before any amount.
    expect(screen.getByText("Ajouter quelqu'un")).toBeDefined();
    expect(screen.queryByText('Total = somme')).toBeNull();
    await user.click(member('Alice'));
    await user.click(member('Chloé'));
    expect(screen.queryByText("Ajouter quelqu'un")).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retirer Bruno (toi)' }));
    expect(screen.queryByLabelText('Montant de Bruno (toi)')).toBeNull();
    await user.type(field('Montant de Alice'), '12,50');
    await user.type(field('Montant de Chloé'), '7');
    // Without a total, the amounts make it.
    expect(screen.getByText('Total = somme')).toBeDefined();
    expect(field('Total, calculé').getAttribute('placeholder')).toBe('19,50');
    await user.type(field('Total, calculé'), '20');
    expect(screen.getByText(shown(`Reste ${euros('0,50')}`))).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ajouter' }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText(shown(`La somme des montants (${euros('19,50')}) ne fait pas le total (${euros('20,00')}).`))).toBeDefined();
    await user.clear(field('Total, contrôle'));
    await user.type(field('Total, calculé'), '19');
    expect(screen.getByText(shown(`Dépasse de ${euros('0,50')}`))).toBeDefined();
    expect(posted).toStrictEqual([]);

    await user.clear(field('Total, contrôle'));
    await user.type(field('Total, calculé'), '19,50');
    expect(screen.getByText('Total = somme')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('heading', { name: 'Restaurant' })).toBeDefined();
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted).toMatchObject([
      {
        entry: {
          payer: 'm1',
          lines: [
            { member: 'm1', amount: 1_250 },
            { member: 'm3', amount: 700 },
          ],
        },
      },
    ]);
    // Not in the split, not the payer: not involved.
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    expect(screen.getByRole('link', { name: /Restaurant/ }).textContent).toContain('Pas concerné');
  });

  it('turns equal shares into amounts, each the share it was', async () => {
    const { user } = await openAsBruno('/nouvelle-depense');
    await user.click(screen.getByRole('button', { name: 'Tous' }));
    await user.type(field('Montant'), '10');
    await user.selectOptions(field('Répartition'), 'montants');
    const lines = ['Montant de Alice', 'Montant de Bruno (toi)', 'Montant de Chloé'].map(value);
    expect(lines.toSorted()).toStrictEqual(['3,33', '3,33', '3,34']);
    expect(value('Total, contrôle')).toBe('10');
    expect(screen.getByText('Total = somme')).toBeDefined();
  });

  it('marks a line left empty, and an unreadable one', async () => {
    const { user, posted } = await openAsBruno('/nouvelle-depense');
    await user.type(field('Quoi'), 'Restaurant');
    await user.selectOptions(field('Répartition'), 'montants');
    await user.click(member('Alice'));
    await user.type(field('Montant de Alice'), '1,234');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(field('Montant de Alice').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Montant illisible.')).toBeDefined();
    expect(field('Montant de Bruno (toi)').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Montant manquant.')).toBeDefined();
    expect(posted).toStrictEqual([]);
  });

  it('asks before closing what was typed, and closes at once otherwise', async () => {
    const { user, location } = await openAsBruno();
    await user.click(screen.getByRole('link', { name: 'Ajouter une dépense' }));
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(at(location)).toBe('/');

    await user.click(screen.getByRole('link', { name: 'Ajouter une dépense' }));
    await user.type(field('Quoi'), 'Péage');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.getByText('Abandonner cette saisie ? Ce que tu as écrit sera perdu.')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continuer la saisie' }));
    await user.click(screen.getByRole('button', { name: 'Continuer la saisie' }));
    expect(value('Quoi')).toBe('Péage');
    expect(at(location)).toBe('/nouvelle-depense');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, abandonner' }));
    expect(at(location)).toBe('/');
    expect(screen.queryByText('Péage')).toBeNull();
  });

  it('saves without network: the expense shows at once, marked pending and counted in the balances, then leaves when the server answers', async () => {
    let offline = false;
    const { user, posted } = await openAsBruno('/nouvelle-depense', { down: () => offline });
    offline = true;
    await user.type(field('Quoi'), 'Péage');
    await user.type(field('Montant'), '10');
    await user.click(member('Alice'));
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('heading', { name: 'Péage' })).toBeDefined();
    expect(screen.getByText("En attente d'envoi")).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    expect(within(screen.getByRole('link', { name: /Péage/ })).getByText("En attente d'envoi")).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    // Alice paid 45,00 € with 20,00 € on Bruno, who paid 10,00 € split with Alice: 10,00 - 20,00 - 5,00.
    expect(screen.getByRole('link', { name: `Bruno (toi), doit, ${euros('15,00')}` })).toBeDefined();
    expect(screen.getByText(/^Ces soldes comptent 1 saisie non envoyée\. Dernière synchro à \d\d:\d\d\.$/)).toBeDefined();
    expect(posted).toHaveLength(0);

    // A second revision of the same expense counts once.
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    await user.click(screen.getByRole('link', { name: /Péage/ }));
    await user.click(screen.getByRole('link', { name: 'Modifier' }));
    await user.type(field('Quoi'), ' A7');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Péage A7' })).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    expect(screen.getByText(/^Ces soldes comptent 1 saisie non envoyée/)).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    await user.click(screen.getByRole('link', { name: /Courses/ }));
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    await user.click(await screen.findByRole('link', { name: 'Soldes' }));
    expect(screen.getByText(/^Ces soldes comptent 2 saisies non envoyées\. Dernière synchro à \d\d:\d\d\.$/)).toBeDefined();
    // A wake that cannot reach the server says so, with the promise about what waits.
    window.dispatchEvent(new Event('online'));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /^Hors ligne, dernière synchro à \d\d:\d\d : tes saisies partiront au retour du réseau\./,
    );

    offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(screen.getByText(/^Dernière synchro à \d\d:\d\d\.$/)).toBeDefined();
    });
    // Sent in the order entered, both revisions of the toll included.
    expect(posted).toMatchObject([{ title: 'Péage' }, { title: 'Péage A7' }, { title: 'Courses', deleted: true }]);
    expect(posted[1]).not.toHaveProperty('deleted');
  });
});

describe('modifying and deleting', () => {
  it('opens an expense in its form, and saves the change as a new revision', async () => {
    const { user, posted } = await openAsBruno('/operations/op-shopping');
    await user.click(screen.getByRole('link', { name: 'Modifier' }));
    expect(screen.getByRole('heading', { name: 'Modifier la dépense' })).toBeDefined();
    expect(value('Montant de Alice')).toBe('10,00');
    expect(value('Total, contrôle')).toBe('45,00');
    await user.clear(field('Quoi'));
    await user.type(field('Quoi'), 'Courses du samedi');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Courses du samedi' })).toBeDefined();
    // Every share saved as it was, sent once the store has queued it.
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted).toMatchObject([
      {
        id: 'op-shopping',
        title: 'Courses du samedi',
        author: 'm2',
        entry: {
          payer: 'm1',
          lines: [
            { member: 'm1', amount: 1_000 },
            { member: 'm2', amount: 2_000 },
            { member: 'm3', amount: 1_500 },
          ],
        },
      },
    ]);
  });

  it('deletes an operation after asking once more', async () => {
    const { user, location, posted } = await openAsBruno('/operations/op-shopping');
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByText('Supprimer « Courses » pour tout le groupe ?')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeDefined();
    expect(at(location)).toBe('/');
    await waitFor(() => {
      expect(posted).toMatchObject([{ id: 'op-shopping', title: 'Courses', deleted: true, author: 'm2' }]);
    });
  });
});

describe('a send under way', () => {
  /** Holds every POST until `release` is called. */
  const held = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return {
      gate,
      release: () => {
        release();
      },
    };
  };

  it('queues once on a double click', async () => {
    const { user, posted } = await openAsBruno('/nouvelle-depense');
    await user.type(field('Quoi'), 'Péage');
    await user.type(field('Montant'), '10');
    await user.dblClick(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('heading', { name: 'Péage' })).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("En attente d'envoi")).toBeNull();
    });
    expect(posted).toHaveLength(1);
  });

  it('puts the focus on the first field in error, or on the split when only it is wrong', async () => {
    const { user } = await openAsBruno('/nouvelle-depense');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(field('Quoi'));
    });
    await user.type(field('Quoi'), 'Péage');
    await user.type(field('Montant'), '10');
    await user.click(screen.getByRole('button', { name: 'Personne' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('FIELDSET');
    });
  });

  it('deletes once on a double click', async () => {
    const { gate, release } = held();
    const { user, posted } = await openAsBruno('/operations/op-shopping', { hold: gate });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.dblClick(screen.getByRole('button', { name: 'Oui, supprimer' }));
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    release();
    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeDefined();
    // A second deletion would be queued with the first, and sent in the same batch.
    await waitFor(() => {
      expect(posted.length).toBeGreaterThan(0);
    });
    expect(posted).toHaveLength(1);
  });
});

describe('modifying or deleting what is gone', () => {
  it('does not open in the form a reimbursement to several members', async () => {
    await openAsBruno('/operations/op-split/modifier', {
      more: [
        change({
          id: 'op-split',
          date: '2026-11-07',
          payer: 'm2',
          lines: [
            ['m1', 300],
            ['m3', 200],
          ],
          kind: 'reimbursement',
        }),
      ],
    });
    expect(
      screen.getByText('Ce remboursement va à plusieurs membres : il ne se modifie pas dans cette version, seulement se supprime.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('says so for the form of an unknown operation', async () => {
    await openAsBruno('/operations/op-nowhere/modifier');
    expect(screen.getByText("Cette dépense n'existe pas, ou elle a été supprimée.")).toBeDefined();
  });

  it('deletes without network: the operation leaves the list at once, the deletion sent when the server answers', async () => {
    let offline = false;
    const { user, posted } = await openAsBruno('/operations/op-shopping', { down: () => offline });
    offline = true;
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    expect(await screen.findByText("Aucune dépense pour l'instant.")).toBeDefined();
    offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(posted).toMatchObject([{ id: 'op-shopping', deleted: true }]);
    });
    expect(screen.getByText("Aucune dépense pour l'instant.")).toBeDefined();
  });
});
