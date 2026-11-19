import { describe, expect, it } from 'vitest';

import { sendErrorMessage } from './errors.ts';

describe('sendErrorMessage', () => {
  it('tells a failed request as a failed read, and a refused revision by its reason', () => {
    expect(sendErrorMessage('network')).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    expect(sendErrorMessage('unknown_member')).toBe("Un membre de cette opération n'est plus dans le groupe : recharge la page, puis réessaie.");
    for (const reason of ['invalid_operation', 'operation_in_other_group', 'revision_conflict'] as const) {
      expect(sendErrorMessage(reason)).toBe('Le serveur a refusé cette opération : recharge la page, puis réessaie.');
    }
  });
});
