import { type Change, groupResponseSchema, operationBatchSchema } from '@la-pince/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { saveCurrentMember } from '../storage/device.ts';
import type { Fetch } from '../sync/client.ts';
import { change, fakeServer } from '../testing/fake-server.ts';
import { renderApp } from '../testing/render.tsx';

const token = 'demo-token-of-the-form-tests-0123456789';
const group = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
    { id: 'm3', name: 'Chloé' },
  ],
});
const nbsp = ' ';
const euros = (amount: string) => `${amount}${nbsp}€`;
// `getByText` collapses the spaces of the page, no-break ones included, but not those of the text looked for.
const shown = (text: string) => text.replace(/\s+/g, ' ');

/** Opens the group as Bruno on a fake server holding one expense of Alice, and records what the app posts. */
async function openAsBruno(path = '', options: { down?: (url: string, init?: RequestInit) => boolean } = {}) {
  const changes: Change[] = [
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
    }),
  ];
  const server = fakeServer({ token, group, changes });
  const posted: unknown[] = [];
  const fetchFn: Fetch = (url, init) => {
    if (options.down?.(url, init) === true) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (init?.method === 'POST' && typeof init.body === 'string') {
      posted.push(...operationBatchSchema.parse(JSON.parse(init.body)).operations);
    }
    return server.fetch(url, init);
  };
  saveCurrentMember(token, 'm2');
  const location = renderApp(`/g/${token}${path}`, fetchFn);
  await screen.findByText('Tu es Bruno');
  return { user: userEvent.setup(), location, posted, changes };
}

const field = (name: string) => screen.getByLabelText(name);
const at = (location: { history: readonly string[] }) => location.history.at(-1)?.replace(`/g/${token}`, '');

describe('adding an expense', () => {
  it('splits it equally between the members checked, previews each share, and opens it once saved', async () => {
    const { user, location, posted } = await openAsBruno();
    await user.click(screen.getByRole('link', { name: 'Ajouter une dépense' }));
    expect(screen.getByRole('heading', { name: 'Nouvelle dépense' })).toBeDefined();
    // Who I am first, as payer and in the split.
    expect(
      within(field('Payé par'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toStrictEqual(['Bruno (toi)', 'Alice', 'Chloé']);

    await user.type(field('Titre'), 'Péage');
    await user.type(field('Montant'), '10');
    fireEvent.change(field('Date'), { target: { value: '2026-11-08' } });
    await user.click(screen.getByRole('checkbox', { name: /Chloé/ }));
    const split = within(screen.getByRole('group', { name: 'Répartition' }));
    expect(split.getAllByRole('listitem').map((line) => line.textContent)).toStrictEqual([euros('Bruno (toi)5,00'), euros('Alice5,00'), 'Chloé']);

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Péage' })).toBeDefined();
    expect(at(location)).toMatch(/^\/operations\/[0-9a-f-]{36}$/);
    expect(screen.getByText('dimanche 8 novembre 2026')).toBeDefined();
    expect(screen.getByText('Saisi par Bruno (toi)')).toBeDefined();
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
            { member: 'm1', weight: 1 },
            { member: 'm2', weight: 1 },
          ],
        },
      },
    ]);
  });

  it('tells what is missing before sending anything', async () => {
    const { user, location, posted } = await openAsBruno('/nouvelle-depense');
    await user.click(screen.getByRole('button', { name: 'Tout décocher' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Donne un titre.')).toBeDefined();
    expect(screen.getByText('Indique le montant.')).toBeDefined();
    expect(screen.getByText('Coche au moins un membre.')).toBeDefined();
    expect(field('Titre').getAttribute('aria-invalid')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Tout cocher' }));
    expect(screen.queryByText('Coche au moins un membre.')).toBeNull();
    expect(posted).toStrictEqual([]);
    expect(at(location)).toBe('/nouvelle-depense');
  });

  it('splits it by amounts, checked against a control total', async () => {
    const { user, posted } = await openAsBruno('/nouvelle-depense');
    await user.type(field('Titre'), 'Restaurant');
    await user.click(screen.getByRole('button', { name: 'Montants' }));
    await user.selectOptions(field('Payé par'), 'Alice');
    await user.type(field('Montant de Alice'), '12,50');
    await user.type(field('Montant de Chloé'), '7');
    expect(screen.getByText(shown(`Somme des montants : ${euros('19,50')}`))).toBeDefined();
    await user.type(field('Total, pour contrôle (facultatif)'), '20');
    expect(screen.getByText(shown(`Somme des montants : ${euros('19,50')} · Reste à répartir : ${euros('0,50')}`))).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText(shown(`La somme des montants (${euros('19,50')}) ne fait pas le total (${euros('20,00')}).`))).toBeDefined();
    expect(posted).toStrictEqual([]);

    await user.clear(field('Total, pour contrôle (facultatif)'));
    await user.type(field('Total, pour contrôle (facultatif)'), '19,50');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Restaurant' })).toBeDefined();
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

  it('marks an unreadable member amount', async () => {
    const { user, posted } = await openAsBruno('/nouvelle-depense');
    await user.type(field('Titre'), 'Restaurant');
    await user.click(screen.getByRole('button', { name: 'Montants' }));
    await user.type(field('Montant de Alice'), '1,234');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(field('Montant de Alice').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Montant illisible.')).toBeDefined();
    expect(posted).toStrictEqual([]);
  });

  it('stays on the form and tells a server out of reach', async () => {
    const { user, location } = await openAsBruno('/nouvelle-depense', { down: (_, init) => init?.method === 'POST' });
    await user.type(field('Titre'), 'Péage');
    await user.type(field('Montant'), '10');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    expect(at(location)).toBe('/nouvelle-depense');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDefined();
  });

  it('keeps the group shown when the read after the write fails, and offers to read it again', async () => {
    let written = false;
    const { user } = await openAsBruno('/nouvelle-depense', {
      down: (url, init) => {
        if (init?.method === 'POST') {
          written = true;
          return false;
        }
        return written && url.includes('changes');
      },
    });
    await user.type(field('Titre'), 'Péage');
    await user.type(field('Montant'), '10');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Le groupe n'a pas pu être relu");
    // Written but not read back yet: the detail does not know it.
    expect(screen.getByText("Cette dépense n'existe pas, ou elle a été supprimée.")).toBeDefined();
    written = false;
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Péage' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('modifying and deleting', () => {
  it('opens an expense in its form, and saves the change as a new revision', async () => {
    const { user, posted } = await openAsBruno('/operations/op-shopping');
    await user.click(screen.getByRole('link', { name: 'Modifier' }));
    expect(screen.getByRole('heading', { name: 'Modifier la dépense' })).toBeDefined();
    expect((field('Montant de Alice') as HTMLInputElement).value).toBe('10,00');
    expect((field('Total, pour contrôle (facultatif)') as HTMLInputElement).value).toBe('45,00');
    await user.clear(field('Titre'));
    await user.type(field('Titre'), 'Courses du samedi');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Courses du samedi' })).toBeDefined();
    expect(posted).toMatchObject([{ id: 'op-shopping', title: 'Courses du samedi', author: 'm2' }]);
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
    expect(posted).toMatchObject([{ id: 'op-shopping', title: 'Courses', deleted: true, author: 'm2' }]);
  });
});

describe('modifying or deleting what is gone', () => {
  it('says so for the form of an unknown operation', async () => {
    await openAsBruno('/operations/op-nowhere/modifier');
    expect(screen.getByText("Cette dépense n'existe pas, ou elle a été supprimée.")).toBeDefined();
  });

  it('keeps the operation and tells a failed deletion', async () => {
    const { user } = await openAsBruno('/operations/op-shopping', { down: (_, init) => init?.method === 'POST' });
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    expect(screen.getByRole('heading', { name: 'Courses' })).toBeDefined();
  });
});

describe('a reimbursement', () => {
  it('opens prefilled from a suggested transfer, and settles the balances once saved', async () => {
    const { user, posted } = await openAsBruno('/soldes');
    await user.click(screen.getByRole('link', { name: /Enregistrer ce remboursement : Bruno \(toi\) doit 20,00/ }));
    expect(screen.getByRole('heading', { name: 'Nouveau remboursement' })).toBeDefined();
    expect((field('Titre') as HTMLInputElement).value).toBe('Remboursement');
    expect((field('Montant') as HTMLInputElement).value).toBe('20,00');
    expect((field('De') as HTMLSelectElement).value).toBe('m2');
    expect((field('À') as HTMLSelectElement).value).toBe('m1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Bruno (toi) a remboursé Alice')).toBeDefined();
    expect(posted).toMatchObject([
      { title: 'Remboursement', entry: { kind: 'reimbursement', payer: 'm2', lines: [{ member: 'm1', amount: 2_000 }] } },
    ]);
    await user.click(screen.getByRole('link', { name: 'Soldes' }));
    expect(screen.getAllByText('Bruno (toi)').at(0)?.nextSibling?.textContent).toBe(euros('0,00'));
  });

  it('needs someone to receive it', async () => {
    const { user, posted } = await openAsBruno('/nouveau-remboursement?de=stranger&montant=1.5');
    expect((field('De') as HTMLSelectElement).value).toBe('m2');
    expect((field('Montant') as HTMLInputElement).value).toBe('');
    await user.type(field('Montant'), '5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Choisis qui reçoit le remboursement.')).toBeDefined();
    await user.selectOptions(field('À'), 'Bruno (toi)');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('On ne se rembourse pas soi-même : choisis un autre membre.')).toBeDefined();
    expect(posted).toStrictEqual([]);
  });
});
