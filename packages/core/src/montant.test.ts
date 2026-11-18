import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { montantSaisiSchema } from './montant.ts';

describe('montantSaisiSchema', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12,5', 1250],
    ['12,05', 1205],
    ['12.34', 1234],
    ['0,01', 1],
    ['  7,10 ', 710],
    ['1 234,56', 123456],
    ['1\u00A0234,56', 123456],
    ['1\u202F234\u202F567', 123456700],
    ['99999999,99', 9999999999],
    ['007', 700],
    ['000000001', 100],
    ['0 099 999 999,99', 9999999999],
  ])('convertit « %s » en %i centimes', (saisie, centimes) => {
    expect(montantSaisiSchema.parse(saisie)).toBe(centimes);
  });

  it.each([
    ['', 'vide'],
    ['abc', 'non numérique'],
    ['-5', 'négatif'],
    ['12,345', 'trois décimales'],
    ['12,', 'virgule sans décimale'],
    [',5', 'sans partie entière'],
    ['12 34', 'groupe de milliers incomplet'],
    ['1,2,3', 'deux séparateurs décimaux'],
    ['1e3', 'notation scientifique'],
    ['100000000', 'au-delà du plafond'],
    ['1.234', 'point ambigu entre milliers et décimales'],
    ['1.234,56', 'milliers séparés par un point'],
    ['1234 567', 'premier groupe de plus de trois chiffres'],
    ['１２', 'chiffres non ASCII'],
  ])('refuse « %s » (%s)', (saisie) => {
    const resultat = montantSaisiSchema.safeParse(saisie);
    expect(resultat.success).toBe(false);
    expect(resultat.error?.issues[0]?.message).toBe('montant_invalide');
  });

  it.each([undefined, null, 12])('refuse une saisie qui n’est pas du texte (%s)', (saisie) => {
    const resultat = montantSaisiSchema.safeParse(saisie);
    expect(resultat.success).toBe(false);
    expect(resultat.error?.issues[0]?.message).toBe('montant_invalide');
  });

  it('retrouve tout montant en centimes, quelle que soit son écriture', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999_999 }),
        fc.boolean(),
        fc.constantFrom(',', '.'),
        fc.nat(),
        (centimes, groupe, separateur, choix) => {
          const euros = Math.floor(centimes / 100);
          const reste = centimes % 100;
          const entier = groupe ? new Intl.NumberFormat('fr-FR').format(euros) : String(euros);
          // Écritures exactes possibles de la partie décimale : « ,05 » toujours, « ,5 » pour 50 centimes, rien pour un compte rond.
          const decimales = [`${separateur}${String(reste).padStart(2, '0')}`];
          if (reste % 10 === 0) {
            decimales.push(`${separateur}${String(reste / 10)}`);
          }
          if (reste === 0) {
            decimales.push('');
          }
          const saisie = `${entier}${decimales[choix % decimales.length] ?? ''}`;
          expect(montantSaisiSchema.parse(saisie)).toBe(centimes);
        },
      ),
    );
  });
});
