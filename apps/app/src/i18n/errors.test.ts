import { describe, expect, it } from 'vitest';

import { editErrorMessage, notificationErrorMessage, photoErrorMessage, queueErrorMessage } from './errors.ts';

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

describe('editErrorMessage', () => {
  it('tells why an edit of the group failed, and the read errors as a read tells them', () => {
    expect(editErrorMessage('member_name_taken')).toBe('Un autre membre du groupe porte déjà ce prénom.');
    expect(editErrorMessage('too_many_members')).toBe('Le groupe a atteint son nombre maximal de membres.');
    expect(editErrorMessage('member_not_found')).toBe("Ce membre n'est plus dans le groupe : recharge la page.");
    expect(editErrorMessage('invalid_request')).toBe("Le serveur refuse ce texte : vérifie qu'il n'est pas vide, puis réessaie.");
    expect(editErrorMessage('network')).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
  });
});

describe('photoErrorMessage', () => {
  it('tells why a change of photo failed or the picture could not become one, and the read errors as a read tells them', () => {
    expect(photoErrorMessage('photo_changed')).toBe('La photo a été changée entre-temps.');
    expect(photoErrorMessage('photos_unavailable')).toBe('Photo non enregistrée, réessaie plus tard.');
    expect(photoErrorMessage('photos_disabled')).toBe('Ce serveur ne garde pas de photos.');
    expect(photoErrorMessage('invalid_request')).toBe('Le serveur refuse cette photo : choisis-en une autre.');
    expect(photoErrorMessage('unreadable')).toBe('Format non pris en charge, choisis une autre photo.');
    expect(photoErrorMessage('not_encoded')).toBe("Ce navigateur n'a pas pu préparer la photo : choisis-en une autre.");
    expect(photoErrorMessage('member_not_found')).toBe("Ce membre n'est plus dans le groupe : recharge la page.");
    expect(photoErrorMessage('network')).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
  });
});
