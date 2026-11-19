import type { LoadError } from '../sync/client.ts';
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
