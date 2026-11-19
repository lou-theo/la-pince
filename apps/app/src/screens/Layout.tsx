import type { ReactNode } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import styles from './Layout.module.css';

/** Frame of every screen: the app's name, then the screen in one centered column. */
export function Layout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img className={styles.logo} src="/icon.svg" alt="" />
        {m.app_name()}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
