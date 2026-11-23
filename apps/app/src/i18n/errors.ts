import type { LoadError, NotificationError } from '../sync/client.ts';
import type { QueueError } from '../sync/groupStore.ts';
import { m } from './paraglide/messages.js';

/** Message shown for each error code the app can meet; the switch is exhaustive, so that a new code cannot go untranslated. */
export function loadErrorMessage(error: LoadError): string {
  switch (error) {
    case 'group_not_found':
      return m.error_group_not_found();
    case 'network':
      return m.error_network();
    case 'unexpected':
      return m.error_unexpected();
  }
}

/** Message shown when a revision could not be queued. */
export function queueErrorMessage(error: QueueError): string {
  switch (error) {
    case 'unknown_member':
      return m.error_unknown_member();
    case 'not_stored':
      return m.error_not_stored();
  }
}

/** Message shown when a request about notifications failed. */
export function notificationErrorMessage(error: NotificationError): string {
  switch (error) {
    case 'notifications_disabled':
      return m.error_notifications_disabled();
    case 'too_many_subscriptions':
      return m.error_too_many_subscriptions();
    case 'invalid_request':
      return m.error_invalid_request();
    case 'subscription_not_found':
      return m.error_subscription_not_found();
    case 'group_not_found':
    case 'network':
    case 'unexpected':
      return loadErrorMessage(error);
  }
}
