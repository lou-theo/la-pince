import { describe, expect, it } from 'vitest';

import { type Board, boardHtml } from './board.ts';

const board: Board = {
  title: 'Téléphone',
  versions: ['Avant', 'Après'],
  screens: [
    { label: 'Qui je suis', images: [undefined, 'apres/qui-je-suis.png'] },
    { label: 'Accueil', images: ['avant/accueil.png', 'apres/accueil.png'] },
  ],
  imageWidth: 390,
  screensGo: 'down',
};
const image = (name: string, label: string) => `<td><img src="${name}" width="390" alt="${label}"></td>`;

describe('boardHtml', () => {
  it('puts one screen on each row and one version in each column, a screen missing from a version marked absent', () => {
    const html = boardHtml(board);
    expect(html).toContain('<thead><tr><th></th><th>Avant</th><th>Après</th></tr></thead>');
    expect(html).toContain(`<tr><th scope="row">Qui je suis</th><td class="absent">absent</td>${image('apres/qui-je-suis.png', 'Qui je suis')}</tr>`);
    expect(html).toContain(`<tr><th scope="row">Accueil</th>${image('avant/accueil.png', 'Accueil')}${image('apres/accueil.png', 'Accueil')}</tr>`);
  });

  it('turns the board for narrow screenshots: one screen in each column, one version on each row', () => {
    const html = boardHtml({ ...board, screensGo: 'across' });
    expect(html).toContain('<thead><tr><th></th><th>Qui je suis</th><th>Accueil</th></tr></thead>');
    expect(html).toContain(`<tr><th scope="row">Avant</th><td class="absent">absent</td>${image('avant/accueil.png', 'Accueil')}</tr>`);
    expect(html).toContain(
      `<tr><th scope="row">Après</th>${image('apres/qui-je-suis.png', 'Qui je suis')}${image('apres/accueil.png', 'Accueil')}</tr>`,
    );
  });

  it('escapes the texts it is given', () => {
    const html = boardHtml({ ...board, title: '<b>', versions: ['"a" & \'b\''], screens: [{ label: 'x<y', images: ['a"b.png'] }] });
    expect(html).toContain('<h1>&lt;b&gt;</h1>');
    expect(html).toContain('<th>&quot;a&quot; &amp; &#39;b&#39;</th>');
    expect(html).toContain('<img src="a&quot;b.png" width="390" alt="x&lt;y">');
  });
});
