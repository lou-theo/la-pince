import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { openAsBruno } from '../testing/group.ts';

const token = 'demo-token-of-the-transfer-tests-01234567';
const euros = (amount: string) => `${amount}\u00a0€`;
const pay = (line: string) => screen.getByRole('button', { name: `C'est payé : ${line}` });
const band = () => screen.findByRole('status');
const heads = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.getAttribute('aria-label'));

describe("“C'est payé” on the transfers", () => {
  it('records the transfer at once, keeps its line “Payé” and the order of the cards, and offers to undo it', async () => {
    const { user, batches } = await openAsBruno(token, '/soldes/virements');
    expect(heads()).toStrictEqual([`Bruno (toi), doit, ${euros('20,00')}`, `Chloé, doit, ${euros('15,00')}`]);
    await user.click(pay(`Bruno (toi) doit ${euros('20,00')} à Alice`));

    // Bruno is settled, his card staying first with its line struck.
    expect(heads()).toStrictEqual(['Bruno (toi), à jour', `Chloé, doit, ${euros('15,00')}`]);
    expect(screen.getByRole('listitem', { name: `Payé : Toi → Alice · ${euros('20,00')}` }).textContent).toBe(`à Alice${euros('20,00')}Payé`);
    expect((await band()).textContent).toBe(`Remboursement enregistréToi → Alice · ${euros('20,00')}Annuler`);
    await waitFor(() => {
      expect(batches).toHaveLength(1);
    });
    expect(batches[0]).toMatchObject([
      { title: 'Remboursement', author: 'm2', entry: { kind: 'reimbursement', payer: 'm2', lines: [{ member: 'm1', amount: 2_000 }] } },
    ]);

    // Another payment replaces the band; Chloé's line stays where it was.
    await user.click(pay(`Chloé doit ${euros('15,00')} à Alice`));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(`Chloé → Alice · ${euros('15,00')}`);
    });
    expect(heads()).toStrictEqual(['Bruno (toi), à jour', 'Chloé, à jour']);
    expect(screen.queryByRole('button', { name: /^C'est payé/ })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    expect(screen.getByText('Tout le monde est à jour')).toBeDefined();
  });

  it('undoes the payment: its line leaves, the transfer comes back, the deletion is sent', async () => {
    const { user, batches } = await openAsBruno(token, '/soldes/virements');
    await user.click(pay(`Bruno (toi) doit ${euros('20,00')} à Alice`));
    await band();
    await user.click(screen.getByRole('button', { name: 'Annuler ce remboursement' }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(screen.queryByRole('listitem', { name: /^Payé/ })).toBeNull();
    expect(heads()).toStrictEqual([`Bruno (toi), doit, ${euros('20,00')}`, `Chloé, doit, ${euros('15,00')}`]);
    expect(pay(`Bruno (toi) doit ${euros('20,00')} à Alice`)).toBeDefined();
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(2);
    });
    const [added, deleted] = batches.flat();
    expect(deleted).toMatchObject({ id: added?.id, deleted: true, title: 'Remboursement', author: 'm2' });
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    expect(screen.getByRole('link', { name: `Bruno (toi), doit, ${euros('20,00')}` })).toBeDefined();
  });

  it('records one payment for two touches while the phone saves it', async () => {
    const { user, batches } = await openAsBruno(token, '/soldes/virements');
    // Both touches land before the phone has stored the first.
    const mine = pay(`Bruno (toi) doit ${euros('20,00')} à Alice`);
    const chloe = pay(`Chloé doit ${euros('15,00')} à Alice`);
    fireEvent.click(mine);
    fireEvent.click(mine);
    fireEvent.click(chloe);
    expect(await screen.findByRole('status')).toBeDefined();
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(1);
    });
    expect(heads()).toStrictEqual(['Bruno (toi), à jour', `Chloé, doit, ${euros('15,00')}`]);
    // Once stored, the next one goes through.
    await user.click(pay(`Chloé doit ${euros('15,00')} à Alice`));
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(2);
    });
  });

  it('works without network: paid then undone, both leave in one batch when the server answers', async () => {
    let offline = false;
    const { user, batches } = await openAsBruno(token, '/soldes/virements', { down: () => offline });
    offline = true;
    await user.click(pay(`Chloé doit ${euros('15,00')} à Alice`));
    expect(heads()).toStrictEqual([`Bruno (toi), doit, ${euros('20,00')}`, 'Chloé, à jour']);
    await band();
    expect(screen.getByText(/^Ces soldes comptent 1 saisie non envoyée\./)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Annuler ce remboursement' }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(heads()).toStrictEqual([`Bruno (toi), doit, ${euros('20,00')}`, `Chloé, doit, ${euros('15,00')}`]);
    expect(batches).toStrictEqual([]);

    offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(batches).toHaveLength(1);
    });
    expect(batches[0]).toMatchObject([{ entry: { payer: 'm3' } }, { deleted: true }]);
    expect(batches[0]?.[1]?.id).toBe(batches[0]?.[0]?.id);
  });

  it('forgets the band and the struck line once the screen is left, the reimbursement staying in the list', async () => {
    const { user } = await openAsBruno(token, '/soldes/virements');
    await user.click(pay(`Bruno (toi) doit ${euros('20,00')} à Alice`));
    await band();
    await user.click(screen.getByRole('link', { name: 'Retour aux soldes' }));
    await user.click(screen.getByRole('link', { name: /^Pour tout solder/ }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(heads()).toStrictEqual([`Chloé, doit, ${euros('15,00')}`]);
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    expect(screen.getByRole('link', { name: /Remboursement/ }).textContent).toContain('Tu as remboursé Alice');
  });
});

describe("“C'est payé” on a member's sheet", () => {
  it('records the transfer and offers to undo it, as on the transfers', async () => {
    const { user, batches } = await openAsBruno(token, '/soldes/membres/m1');
    const owed = () => within(screen.getByRole('region', { name: 'Lui doivent' }));
    await user.click(pay(`Chloé doit ${euros('15,00')} à Alice`));
    expect(owed().getByRole('listitem', { name: `Payé : Chloé → Alice · ${euros('15,00')}` })).toBeDefined();
    expect((await band()).textContent).toContain('Remboursement enregistré');
    expect(screen.getByText(/^en positif de/).textContent).toBe(`en positif de ${euros('20,00')}`);
    await user.click(screen.getByRole('button', { name: 'Annuler ce remboursement' }));
    await waitFor(() => {
      expect(owed().queryByRole('listitem', { name: /^Payé/ })).toBeNull();
    });
    expect(screen.getByText(/^en positif de/).textContent).toBe(`en positif de ${euros('35,00')}`);
    await waitFor(() => {
      expect(batches.flat()).toHaveLength(2);
    });
  });
});
