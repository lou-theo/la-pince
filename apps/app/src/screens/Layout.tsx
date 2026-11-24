import { createContext, type ReactNode, use, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';

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
  /** The band holds the bar of the screen below (a form, a screen under a tab), filled by `ScreenBar`, instead of the logo, the title and the actions. */
  readonly screenBar?: boolean;
}

// The band of a screen that puts its own bar there: a form's state (changed, sending) lives in the form, not in the screen around it.
const BarContext = createContext<HTMLElement | null>(null);

/** Frame of every screen: a band with the logo and the title, the screen in one centered column, and the menu at the bottom if any. */
export function Layout({ children, title, actions, nav, screenBar = false }: LayoutProps): ReactNode {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  return (
    <BarContext value={bar}>
      <header className={styles.band}>
        {screenBar ? (
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

/** What a screen shows in the band of a `Layout` given `screenBar`: nothing until the band is there. */
export function ScreenBar({ children }: { readonly children: ReactNode }): ReactNode {
  const bar = use(BarContext);
  return bar === null ? null : createPortal(children, bar);
}

/** The band of a screen under a tab: a link back to the tab (not the browser's back, the screen being reachable by its address) and the title. */
export function BackBar({ href, label, title }: { readonly href: string; readonly label: string; readonly title: string }): ReactNode {
  return (
    <ScreenBar>
      <Link className={styles.iconButton} href={href} aria-label={label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </Link>
      <h1 className={`${styles.name ?? ''} ${styles.subTitle ?? ''}`} title={title}>
        {title}
      </h1>
    </ScreenBar>
  );
}
