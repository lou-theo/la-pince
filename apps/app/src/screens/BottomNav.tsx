import type { ReactNode } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import styles from './BottomNav.module.css';

/** Part of the group a screen belongs to: the expenses (list and detail), the balances, who I am, or a form, which takes the whole screen. */
export type Section = 'operations' | 'balances' | 'me' | 'form';

// The routes match with or without a trailing slash.
const trimmed = (location: string) => location.replace(/(.)\/+$/, '$1');

/** Section of a path under the group's link, the screens under the balances included; an unknown path belongs to the expenses. */
export function sectionOf(location: string): Section {
  const path = trimmed(location);
  if (path === '/soldes' || path.startsWith('/soldes/')) {
    return 'balances';
  }
  if (path === '/moi') {
    return 'me';
  }
  return /^\/(nouvelle-depense|nouveau-remboursement|operations\/[^/]+\/modifier)$/.test(path) ? 'form' : 'operations';
}

/**
 * A screen under a tab (the transfers, a member's sheet), which puts a way back and its title in the band, the menu staying; an unknown path under
 * the balances keeps the group's band, nothing filling a screen's own.
 */
export function isSubScreen(location: string): boolean {
  return /^\/soldes\/(virements|membres\/[^/]+)$/.test(trimmed(location));
}

/** Menu at the bottom of the group's screens: the expenses and the balances, the current one marked. */
export function BottomNav({ section }: { readonly section: Section }): ReactNode {
  return (
    <nav className={styles.nav} aria-label={m.tabs_label()}>
      <Tab href="/" active={section === 'operations'} label={m.tab_operations()}>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </Tab>
      <Tab href="/soldes" active={section === 'balances'} label={m.tab_balances()}>
        <path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" />
      </Tab>
    </nav>
  );
}

function Tab({
  href,
  active,
  label,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Link className={active ? `${styles.tab ?? ''} ${styles.active ?? ''}` : styles.tab} href={href} aria-current={active ? 'page' : undefined}>
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
      {label}
    </Link>
  );
}
