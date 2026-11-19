import { describe, expect, it } from 'vitest';

import { queueErrorMessage } from './errors.ts';

describe('queueErrorMessage', () => {
  it('tells why a revision could not be queued', () => {
    expect(queueErrorMessage('unknown_member')).toBe("Un membre de cette opération n'est plus dans le groupe : recharge la page, puis réessaie.");
    expect(queueErrorMessage('not_stored')).toBe(
      "Ce téléphone n'a pas pu garder ta saisie (stockage plein ou refusé) : libère de la place, puis réessaie.",
    );
  });
});
