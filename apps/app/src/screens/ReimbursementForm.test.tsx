import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { openAsBruno } from '../testing/group.ts';

const token = 'demo-token-of-the-reimbursement-tests-0123';
const euros = (amount: string) => `${amount}\u00a0€`;
// `getByText` collapses the spaces of the page, no-break ones included, but not those of the text looked for.
const shown = (text: string) => text.replace(/\s+/g, ' ');
const side = (name: RegExp) => screen.getByRole('button', { name });
const grid = () => within(screen.getByRole('region'));
const gridNames = () =>
  grid()
    .getAllByRole('button')
    .map((button) => button.textContent);
const at = (location: { history: readonly string[] }) => location.history.at(-1)?.replace(`/g/${token}`, '');

describe('the reimbursement page', () => {
  it('opens from the transfers given by me, asks who receives it in the order of the balances, and saves it', async () => {
    const { user, location, batches } = await openAsBruno(token, '/soldes/virements');
    await user.click(screen.getByRole('link', { name: 'Déclarer un autre remboursement' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Remboursement' })).toBeDefined();
    expect(side(/^De :/).getAttribute('aria-label')).toBe('De : Bruno (toi)');
    expect(side(/^À :/).getAttribute('aria-label')).toBe('À : à choisir');
    expect(side(/^À :/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(shown(`Tu dois ${euros('20,00')} au groupe.`))).toBeDefined();
    // Alice is owed the most, then Chloé; I am not offered on the other side.
    expect(screen.getByRole('heading', { level: 2, name: 'À qui' })).toBeDefined();
    expect(gridNames()).toStrictEqual(['AAlice', 'CChloé']);
    expect(screen.getByRole('button', { name: 'Enregistrer' }).getAttribute('aria-disabled')).toBe('true');

    await user.click(grid().getByRole('button', { name: 'Alice' }));
    // Both sides filled: the grid leaves until a side is touched.
    expect(screen.queryByRole('region')).toBeNull();
    expect(side(/^À :/).textContent).toBe('ÀAAlicechanger');
    await user.type(screen.getByLabelText('Montant'), '12,5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Bruno (toi) a remboursé Alice')).toBeDefined();
    expect(at(location)).toMatch(/^\/operations\//);
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(1);
    });
    expect(batches.flat()).toMatchObject([
      { title: 'Remboursement', author: 'm2', entry: { kind: 'reimbursement', payer: 'm2', lines: [{ member: 'm1', amount: 1_250 }] } },
    ]);
  });

  it('opens from a member the group owes with them receiving, and asks who gives it', async () => {
    const { user } = await openAsBruno(token, '/membres/m1?retour=%2Fsoldes');
    await user.click(screen.getByRole('link', { name: 'Déclarer un remboursement' }));
    expect(side(/^De :/).getAttribute('aria-label')).toBe('De : à choisir');
    expect(side(/^De :/).getAttribute('aria-pressed')).toBe('true');
    expect(side(/^À :/).getAttribute('aria-label')).toBe('À : Alice');
    expect(screen.getByText(shown(`Alice est en positif de ${euros('35,00')}.`))).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'De qui' })).toBeDefined();
    expect(gridNames()).toStrictEqual(['CChloé', 'BToi']);

    await user.type(screen.getByLabelText('Montant'), '15');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Choisis qui rembourse.')).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(side(/^De :/));
    });
    await user.click(grid().getByRole('button', { name: 'Chloé' }));
    expect(screen.getByText(shown(`Chloé doit ${euros('15,00')} au groupe.`))).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Chloé a remboursé Alice')).toBeDefined();
  });

  it('opens from my own sheet in positive with me receiving', async () => {
    // Bruno paid 30,00 € for Chloé: the group owes him 10,00 €.
    const more = [change({ id: 'op-mine', date: '2026-11-06', payer: 'm2', lines: [['m3', 3_000]] })];
    const { user } = await openAsBruno(token, '/membres/m2?retour=%2Fsoldes', { more });
    await user.click(screen.getByRole('link', { name: 'Déclarer un remboursement' }));
    expect(side(/^À :/).getAttribute('aria-label')).toBe('À : Bruno (toi)');
    expect(screen.getByText(shown(`Tu es en positif de ${euros('10,00')}.`))).toBeDefined();
    expect(gridNames()).toStrictEqual(['AAlice', 'CChloé']);
  });

  it('changes a side once both are filled, offering everyone but the other side, the current one marked', async () => {
    const { user } = await openAsBruno(token, '/nouveau-remboursement?de=m3&a=m1');
    expect(screen.queryByRole('region')).toBeNull();
    await user.click(side(/^De :/));
    expect(screen.getByRole('heading', { level: 2, name: 'De qui' })).toBeDefined();
    expect(gridNames()).toStrictEqual(['CChloé', 'BToi']);
    expect(grid().getByRole('button', { pressed: true }).getAttribute('aria-label')).toBe('Chloé');
    await user.click(grid().getByRole('button', { name: 'Bruno (toi)' }));
    expect(side(/^De :/).getAttribute('aria-label')).toBe('De : Bruno (toi)');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('refuses the same member on both sides, which only an address can ask', async () => {
    const { user, batches } = await openAsBruno(token, '/nouveau-remboursement?de=m2&a=m2');
    await user.type(screen.getByLabelText('Montant'), '5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('On ne se rembourse pas soi-même : choisis un autre membre.')).toBeDefined();
    expect(side(/^À :/).getAttribute('aria-invalid')).toBe('true');
    expect(batches).toStrictEqual([]);
  });

  it('needs someone to receive it', async () => {
    const { user, batches } = await openAsBruno(token, '/nouveau-remboursement?de=m2');
    await user.type(screen.getByLabelText('Montant'), '5');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Choisis qui reçoit le remboursement.')).toBeDefined();
    expect(side(/^À :/).getAttribute('aria-invalid')).toBe('true');
    expect(batches).toStrictEqual([]);
  });

  it('needs an amount, and ignores a member unknown to the group', async () => {
    const { user } = await openAsBruno(token, '/nouveau-remboursement?de=stranger&a=m1');
    expect(side(/^De :/).getAttribute('aria-label')).toBe('De : à choisir');
    await user.click(grid().getByRole('button', { name: 'Chloé' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Indique le montant.')).toBeDefined();
  });

  it('closes back to the screen it opened from, the balances for any other address, asking first when something was typed', async () => {
    const { user, location } = await openAsBruno(token, '/membres/m3?retour=%2Fsoldes');
    await user.click(screen.getByRole('link', { name: 'Déclarer un remboursement' }));
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(at(location)).toBe('/membres/m3?retour=%2Fsoldes');

    await user.click(screen.getByRole('link', { name: 'Déclarer un remboursement' }));
    await user.type(screen.getByLabelText('Montant'), '3');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    await user.click(screen.getByRole('button', { name: 'Oui, abandonner' }));
    expect(at(location)).toBe('/membres/m3?retour=%2Fsoldes');

    for (const back of ['', '?retour=https%3A%2F%2Fexample.org', '?retour=%2Foperations%2Fop-shopping']) {
      location.navigate(`/g/${token}/nouveau-remboursement${back}`);
      await user.click(await screen.findByRole('button', { name: 'Fermer' }));
      expect(at(location)).toBe('/soldes');
    }
  });
});

describe('modifying a reimbursement', () => {
  const more = [change({ id: 'op-back', date: '2026-11-07', title: 'Virement', payer: 'm3', lines: [['m1', 500]], kind: 'reimbursement' })];

  it('opens with both sides and no grid, and saves the change under its title', async () => {
    const { user, location, batches } = await openAsBruno(token, '/operations/op-back', { more });
    await user.click(screen.getByRole('link', { name: 'Modifier' }));
    expect(side(/^De :/).getAttribute('aria-label')).toBe('De : Chloé');
    expect(side(/^À :/).getAttribute('aria-label')).toBe('À : Alice');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Montant').value).toBe('5,00');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(at(location)).toBe('/operations/op-back');

    await user.click(screen.getByRole('link', { name: 'Modifier' }));
    await user.click(side(/^À :/));
    await user.click(grid().getByRole('button', { name: 'Bruno (toi)' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Chloé a remboursé Bruno (toi)')).toBeDefined();
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(1);
    });
    expect(batches.flat()).toMatchObject([{ id: 'op-back', title: 'Virement', entry: { payer: 'm3', lines: [{ member: 'm2', amount: 500 }] } }]);
  });
});
