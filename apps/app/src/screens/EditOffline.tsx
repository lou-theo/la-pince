import type { ReactNode } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import styles from './Me.module.css';

/** Said above the commands that edit the group, greyed without network (docs/decisions/edition-du-groupe.md, point h). */
export function EditOffline(): ReactNode {
  return (
    <p className={styles.offline} role="status">
      {m.edit_offline()}
    </p>
  );
}
