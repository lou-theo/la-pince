import type { ReactNode } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import styles from './Layout.module.css';

/** Frame of every screen: a band with the app's name, then the screen in one centered column. */
export function Layout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <>
      <header className={styles.band}>
        <div className={styles.header}>
          <img className={styles.logo} src="/logo.svg" alt="" />
          {m.app_name()}
        </div>
      </header>
      <div className={styles.page}>
        <main className={styles.main}>{children}</main>
      </div>
    </>
  );
}
