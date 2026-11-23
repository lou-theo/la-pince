import { describe, expect, it } from 'vitest';

import { notificationErrorMessage, queueErrorMessage } from './errors.ts';

describe('queueErrorMessage', () => {
  it('tells why a revision could not be queued', () => {
    expect(queueErrorMessage('unknown_member')).toBe("Un membre de cette opération n'est plus dans le groupe : recharge la page, puis réessaie.");
    expect(queueErrorMessage('not_stored')).toBe(
      "Ce téléphone n'a pas pu garder ta saisie (stockage plein ou refusé) : libère de la place, puis réessaie.",
    );
  });
});

describe('notificationErrorMessage', () => {
  it('tells why a request about notifications failed, and the read errors as a read tells them', () => {
    expect(notificationErrorMessage('notifications_disabled')).toBe('Les notifications ne sont pas activées sur ce serveur.');
    expect(notificationErrorMessage('too_many_subscriptions')).toBe("Le groupe a atteint le nombre maximal d'appareils abonnés.");
    expect(notificationErrorMessage('invalid_request')).toBe('Le serveur refuse les notifications de ce navigateur.');
    expect(notificationErrorMessage('subscription_not_found')).toBe("Cet appareil n'est plus abonné : active à nouveau les notifications.");
    expect(notificationErrorMessage('network')).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
  });
});
