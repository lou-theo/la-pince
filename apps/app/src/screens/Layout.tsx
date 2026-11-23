import type { ReactNode } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import styles from './Layout.module.css';

interface LayoutProps {
  readonly children: ReactNode;
  /** Title of the screen in the band, the app's name otherwise. */
  readonly title?: string;
  /** Buttons at the end of the band. */
  readonly actions?: ReactNode;
  /** Menu fixed at the bottom of the screen, which the page leaves room for. */
  readonly nav?: ReactNode;
}

/** Frame of every screen: a band with the logo and the title, the screen in one centered column, and the menu at the bottom if any. */
export function Layout({ children, title, actions, nav }: LayoutProps): ReactNode {
  return (
    <>
      <header className={styles.band}>
        <div className={styles.header}>
          <img className={styles.logo} src="/logo.svg" alt="" />
          {title === undefined ? <span className={styles.name}>{m.app_name()}</span> : <h1 className={styles.name}>{title}</h1>}
          {actions}
        </div>
      </header>
      <div className={nav === undefined ? styles.page : `${styles.page ?? ''} ${styles.withNav ?? ''}`}>
        <main className={styles.main}>{children}</main>
      </div>
      {nav}
    </>
  );
}
