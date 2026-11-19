import type { LoadError } from '../sync/client.ts';
import type { SendError } from '../sync/groupStore.ts';
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

/** Message shown when a revision was not written. */
export function sendErrorMessage(error: SendError): string {
  switch (error) {
    case 'group_not_found':
    case 'network':
    case 'unexpected':
      return loadErrorMessage(error);
    case 'unknown_member':
      return m.error_unknown_member();
    // The form only builds valid revisions with fresh identifiers: these mean a client bug or another phone's identifiers.
    case 'invalid_operation':
    case 'operation_in_other_group':
    case 'revision_conflict':
      return m.error_refused();
  }
}
