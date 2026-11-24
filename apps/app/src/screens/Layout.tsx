import { createContext, type ReactNode, use, useState } from 'react';
import { createPortal } from 'react-dom';

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
  /** The band holds the bar of the form below, filled by `FormBar`, instead of the logo, the title and the actions. */
  readonly formBar?: boolean;
}

// The band of a form, where the form puts its own bar: its state (changed, sending) lives in the form, not in the screen around it.
const BarContext = createContext<HTMLElement | null>(null);

/** Frame of every screen: a band with the logo and the title, the screen in one centered column, and the menu at the bottom if any. */
export function Layout({ children, title, actions, nav, formBar = false }: LayoutProps): ReactNode {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  return (
    <BarContext value={bar}>
      <header className={styles.band}>
        {formBar ? (
          <div ref={setBar} className={styles.header} />
        ) : (
          <div className={styles.header}>
            <img className={styles.logo} src="/logo.svg" alt="" />
            {title === undefined ? (
              <span className={styles.name}>{m.app_name()}</span>
            ) : (
              <h1 className={styles.name} title={title}>
                {title}
              </h1>
            )}
            {actions}
          </div>
        )}
      </header>
      <div className={nav === undefined ? styles.page : `${styles.page ?? ''} ${styles.withNav ?? ''}`}>
        <main className={styles.main}>{children}</main>
      </div>
      {nav}
    </BarContext>
  );
}

/** What a form shows in the band of a `Layout` given `formBar`: nothing until the band is there. */
export function FormBar({ children }: { readonly children: ReactNode }): ReactNode {
  const bar = use(BarContext);
  return bar === null ? null : createPortal(children, bar);
}
