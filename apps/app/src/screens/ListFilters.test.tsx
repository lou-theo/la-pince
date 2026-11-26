import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { openAsBruno } from '../testing/group.ts';

const token = 'demo-token-of-the-list-filter-tests-0123';

// Beside Alice's shopping (45,00 €, 20,00 on Bruno): a cinema Bruno paid for Chloé alone, pizzas Chloé paid for Alice, and Chloé paying Bruno back.
const more = [
  change({ id: 'op-cinema', date: '2026-11-04', title: 'Cinéma', payer: 'm2', lines: [['m3', 1_200]] }),
  change({ id: 'op-pizza', date: '2026-11-03', title: 'Pizzas', payer: 'm3', lines: [['m1', 2_000]] }),
  change({ id: 'op-back', date: '2026-11-02', title: 'Remboursement cinéma', kind: 'reimbursement', payer: 'm3', lines: [['m2', 1_200]] }),
];

const open = (path = '/') => openAsBruno(token, path, { more });

/** Titles of the lines of the list, in its order. */
const titles = () =>
  within(screen.getByRole('main'))
    .queryAllByRole('link', { name: /./ })
    .flatMap((link) => {
      const title = link.querySelector('span span');
      return title === null ? [] : [title.textContent];
    });

/** Text of the heading of a filtered list, its spaces made plain. */
const heading = () => screen.queryByText(/ au total · ta part |remboursements? · /)?.textContent.replace(/\s/g, ' ');

describe('pills of the list', () => {
  it('shows every operation without a heading at first, nothing pressed', async () => {
    await open();
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Pizzas', 'Remboursement cinéma']);
    const pills = screen.getByRole('group', { name: 'Filtrer la liste' });
    expect(
      within(pills)
        .getAllByRole('button')
        .map((pill) => [pill.textContent, pill.getAttribute('aria-pressed')]),
    ).toStrictEqual([
      ['Me concerne', 'false'],
      ['Payé par moi', 'false'],
      ['Filtres', null],
    ]);
    expect(heading()).toBeUndefined();
  });

  it('keeps what I have a share of, what I paid, or either under both, and counts the expenses with my share', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Me concerne' }));
    expect(screen.getByRole('button', { name: 'Me concerne' }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toStrictEqual(['Courses', 'Remboursement cinéma']);
    // The reimbursement is shown but not counted: expenses only.
    expect(heading()).toBe('1 dépense · 45,00 € au total · ta part 20,00 €');

    await user.click(screen.getByRole('button', { name: 'Payé par moi' }));
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Remboursement cinéma']);
    expect(heading()).toBe('2 dépenses · 57,00 € au total · ta part 20,00 €');

    await user.click(screen.getByRole('button', { name: 'Me concerne' }));
    expect(titles()).toStrictEqual(['Cinéma']);
    // « Payé par moi » alone keeps the pills: it is a pill, not a criterion of the sheet.
    expect(screen.getByRole('button', { name: 'Payé par moi' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Payé par moi' }));
    expect(titles()).toHaveLength(4);
    expect(heading()).toBeUndefined();
  });

  it('keeps the filters while an operation is open, and back on the list', async () => {
    const { user, location } = await open();
    await user.click(screen.getByRole('button', { name: 'Me concerne' }));
    await user.click(screen.getByRole('link', { name: /^Courses/ }));
    expect(location.history.at(-1)).toBe(`/g/${token}/operations/op-shopping`);
    // No filters in the band of an operation.
    expect(screen.queryByRole('group', { name: 'Filtrer la liste' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Dépenses' }));
    expect(screen.getByRole('button', { name: 'Me concerne' }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toStrictEqual(['Courses', 'Remboursement cinéma']);
  });

  it('keeps « Payé par moi » on whoever I am after I said I am someone else', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Payé par moi' }));
    expect(titles()).toStrictEqual(['Cinéma']);
    await user.click(screen.getByRole('link', { name: 'Tu es Bruno' }));
    await user.click(screen.getByRole('button', { name: "Ce n'est pas moi" }));
    await user.click(screen.getByRole('button', { name: 'Chloé' }));
    await user.click(screen.getByRole('link', { name: 'Retour aux dépenses' }));
    expect(screen.getByRole('button', { name: 'Payé par moi' }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toStrictEqual(['Pizzas', 'Remboursement cinéma']);
  });
});

describe('sheet of the filters', () => {
  it('searches a title whatever its accents, by kind, and turns the pills into a summary that opens it again or clears it all', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Filtres' }));
    const sheet = screen.getByRole('dialog', { name: 'Filtres' });
    await user.type(within(sheet).getByRole('searchbox', { name: 'Chercher un titre' }), 'CINEMA');
    expect(titles()).toStrictEqual(['Cinéma', 'Remboursement cinéma']);
    // An expense and a reimbursement: results, as the heading counts the expense alone.
    expect(within(sheet).getByRole('button', { name: 'Voir 2 résultats' })).toBeDefined();

    const kind = within(sheet).getByRole('group', { name: 'Type' });
    await user.click(within(kind).getByRole('button', { name: 'Remboursements' }));
    expect(within(kind).getByRole('button', { name: 'Remboursements' }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toStrictEqual(['Remboursement cinéma']);
    expect(heading()).toBe('1 remboursement · 12,00 €');
    await user.click(within(sheet).getByRole('button', { name: 'Voir 1 remboursement' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The summary, in place of the pills.
    expect(screen.queryByRole('group', { name: 'Filtrer la liste' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Modifier les filtres : « CINEMA », Remboursements' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Filtres' })).getByRole('button', { name: 'Tout' }));
    expect(heading()).toBe('1 dépense · 12,00 € au total · ta part 0,00 €');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retirer les filtres' }));
    expect(titles()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Filtres' })).toBeDefined();
  });

  it('closes the grid, then the sheet, by a touch on their backdrop, the filters staying', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Filtres' }));
    const sheet = screen.getByRole('dialog', { name: 'Filtres' });
    await user.click(within(sheet).getByRole('button', { name: 'Dépenses' }));
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter un payeur' }));
    const grid = screen.getByRole('dialog', { name: 'Payé par' });
    await user.click(within(grid).getByRole('button', { name: 'Alice' }));
    // A touch on the backdrop lands on the dialog itself.
    fireEvent.pointerDown(grid);
    fireEvent.click(grid);
    expect(screen.queryByRole('dialog', { name: 'Payé par' })).toBeNull();
    fireEvent.pointerDown(sheet);
    fireEvent.click(sheet);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Modifier les filtres : Dépenses' })).toBeDefined();
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Pizzas']);
  });

  it('chooses the payers in the grid of the group, applied by « Valider » only, each removed by its cross', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Payé par moi' }));
    await user.click(screen.getByRole('button', { name: 'Filtres' }));
    const sheet = screen.getByRole('dialog', { name: 'Filtres' });
    // « Payé par moi » is me among the payers.
    const payers = within(sheet).getByRole('region', { name: 'Payé par' });
    expect(
      within(payers)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toStrictEqual(['Te retirer', 'Ajouter un payeur']);

    await user.click(within(payers).getByRole('button', { name: 'Ajouter un payeur' }));
    const grid = screen.getByRole('dialog', { name: 'Payé par' });
    expect(
      within(grid)
        .getAllByRole('button', { pressed: true })
        .map((cell) => cell.getAttribute('aria-label')),
    ).toStrictEqual(['Bruno (toi)']);
    await user.click(within(grid).getByRole('button', { name: 'Chloé' }));
    // Left by Escape: nothing changes.
    fireEvent.keyDown(within(grid).getByRole('button', { name: 'Chloé' }), { key: 'Escape' });
    expect(titles()).toStrictEqual(['Cinéma']);

    await user.click(within(payers).getByRole('button', { name: 'Ajouter un payeur' }));
    expect(within(grid).getByRole('button', { name: 'Chloé' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(within(grid).getByRole('button', { name: 'Chloé' }));
    await user.click(within(grid).getByRole('button', { name: 'Valider · 2 personnes' }));
    expect(titles()).toStrictEqual(['Cinéma', 'Pizzas', 'Remboursement cinéma']);
    // The grid closing leaves the sheet open, the focus not sent behind it.
    expect(screen.getByRole('dialog', { name: 'Filtres' })).toBeDefined();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /^Modifier les filtres :/ }));

    await user.click(within(payers).getByRole('button', { name: 'Te retirer' }));
    expect(titles()).toStrictEqual(['Pizzas', 'Remboursement cinéma']);
    await user.click(within(payers).getByRole('button', { name: 'Ajouter un payeur' }));
    await user.click(within(grid).getByRole('button', { name: 'Aucun' }));
    expect(within(grid).getByRole('button', { name: 'Valider · personne' })).toBeDefined();
    await user.click(within(grid).getByRole('button', { name: 'Chloé' }));
    await user.click(within(grid).getByRole('button', { name: 'Valider · 1 personne' }));
    await user.click(within(sheet).getByRole('button', { name: 'Voir 2 résultats' }));
    // Chloé as a payer is a criterion of the sheet: the summary names her.
    expect(screen.getByRole('button', { name: 'Modifier les filtres : De Chloé' })).toBeDefined();
  });

  it('offers « Tous » or « Au moins un » from two members involved, and bounds the amount and the day', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Filtres' }));
    const sheet = screen.getByRole('dialog', { name: 'Filtres' });
    const involved = within(sheet).getByRole('region', { name: 'Concernés' });
    await user.click(within(involved).getByRole('button', { name: 'Ajouter un concerné' }));
    const grid = screen.getByRole('dialog', { name: 'Concernés' });
    await user.click(within(grid).getByRole('button', { name: 'Alice' }));
    await user.click(within(grid).getByRole('button', { name: 'Valider · 1 personne' }));
    expect(within(involved).queryByRole('group')).toBeNull();
    expect(titles()).toStrictEqual(['Courses', 'Pizzas']);

    await user.click(within(involved).getByRole('button', { name: 'Ajouter un concerné' }));
    await user.click(within(grid).getByRole('button', { name: 'Chloé' }));
    await user.click(within(grid).getByRole('button', { name: 'Valider · 2 personnes' }));
    const mode = within(involved).getByRole('group', { name: 'Concernés' });
    expect(within(mode).getByRole('button', { name: 'Tous' }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toStrictEqual(['Courses']);
    await user.click(within(mode).getByRole('button', { name: 'Au moins un' }));
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Pizzas']);

    await user.type(within(sheet).getByRole('textbox', { name: 'Montant au moins' }), '12');
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Pizzas']);
    await user.type(within(sheet).getByRole('textbox', { name: 'Montant au plus' }), '19,99');
    expect(titles()).toStrictEqual(['Cinéma']);
    await user.clear(within(sheet).getByRole('textbox', { name: 'Montant au plus' }));
    await user.type(within(sheet).getByRole('textbox', { name: 'Montant au plus' }), 'abc');
    expect(within(sheet).getByRole('textbox', { name: 'Montant au plus' }).getAttribute('aria-invalid')).toBe('true');
    expect(titles()).toStrictEqual(['Courses', 'Cinéma', 'Pizzas']);

    fireEvent.change(within(sheet).getByLabelText('Depuis le'), { target: { value: '2026-11-04' } });
    expect(titles()).toStrictEqual(['Courses', 'Cinéma']);
    fireEvent.change(within(sheet).getByLabelText("Jusqu'au"), { target: { value: '2026-11-04' } });
    expect(titles()).toStrictEqual(['Cinéma']);
    expect(heading()).toBe('1 dépense · 12,00 € au total · ta part 0,00 €');
    await user.click(within(sheet).getByRole('button', { name: 'Voir 1 dépense' }));
    const summary = screen.getByRole('button', { name: /^Modifier les filtres :/ });
    expect(summary.getAttribute('aria-label')?.replace(/\s/g, ' ')).toBe(
      "Modifier les filtres : Pour l'un de Alice, Chloé, ≥ 12,00 €, Depuis le 4 nov., Jusqu'au 4 nov.",
    );

    await user.click(summary);
    await user.click(within(sheet).getByRole('button', { name: 'Tout effacer' }));
    expect(titles()).toHaveLength(4);
    expect(within(sheet).getByRole('button', { name: 'Voir 4 résultats' })).toBeDefined();
    await user.click(within(within(sheet).getByRole('group', { name: 'Type' })).getByRole('button', { name: 'Dépenses' }));
    expect(within(sheet).getByRole('button', { name: 'Voir 3 dépenses' })).toBeDefined();
    fireEvent.change(within(sheet).getByLabelText('Depuis le'), { target: { value: '2027-01-01' } });
    expect(within(sheet).getByRole('button', { name: 'Aucun résultat' })).toBeDefined();
    expect(screen.getByText('Aucune dépense ne correspond à ces filtres.')).toBeDefined();
    expect(heading()).toBeUndefined();
  });
});
