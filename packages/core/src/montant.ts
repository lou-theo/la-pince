import { z } from 'zod';

/** Montant en centimes entiers : seule unité de calcul du projet, aucun nombre à virgule. */
export const centimesSchema = z.int().nonnegative().brand('Centimes');
export type Centimes = z.infer<typeof centimesSchema>;

// Séparateurs de milliers acceptés : espace, espace insécable et espace fine insécable (celle que produit Intl en français).
const ESPACES = /[ \u00A0\u202F]/g;
// Partie entière en groupes de trois (« 1 234 ») ou d'un bloc, puis au plus deux décimales après une virgule ou un point.
const MONTANT_SAISI = /^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))?$/;
// Plafond : 99 999 999,99 €, loin au-dessus de tout usage et sous Number.MAX_SAFE_INTEGER une fois en centimes.
const CHIFFRES_ENTIERS_MAX = 8;
const MONTANT_INVALIDE = 'montant_invalide';

/** Montant tapé par une personne (« 12 », « 12,5 », « 1 234,56 ») converti en centimes ; une saisie invalide est refusée, jamais arrondie. */
export const montantSaisiSchema = z
  .string({ error: MONTANT_INVALIDE })
  .transform((saisie, contexte) => {
    const morceaux = MONTANT_SAISI.exec(saisie.trim().replace(ESPACES, ' '));
    // Les zéros de tête ne comptent pas dans le plafond : « 000000001 » vaut 1 €.
    const entier = morceaux?.[1]?.replace(ESPACES, '').replace(/^0+(?=\d)/, '');
    if (entier === undefined || entier.length > CHIFFRES_ENTIERS_MAX) {
      contexte.addIssue({ code: 'custom', message: MONTANT_INVALIDE });
      return z.NEVER;
    }
    const decimales = (morceaux?.[2] ?? '').padEnd(2, '0');
    return Number.parseInt(entier, 10) * 100 + Number.parseInt(decimales, 10);
  })
  .pipe(centimesSchema);
