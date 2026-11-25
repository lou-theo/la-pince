import type { ReactNode } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import styles from './BottomNav.module.css';

/**
 * Part of the group a screen belongs to: the expenses (list and detail), the balances (the transfers included), the two tabs of my page (who I am
 * and the group), a member's sheet, or a form.
 */
export type Section = 'operations' | 'balances' | 'me' | 'members' | 'sheet' | 'form';

/** What frames a screen: its section, whether the menu at the bottom shows, and whether the band holds the screen's own bar instead of the group's. */
export interface Chrome {
  readonly section: Section;
  readonly nav: boolean;
  readonly screenBar: boolean;
}

// The routes match with or without one trailing slash, as wouter's do.
const trimmed = (location: string) => location.replace(/(.)\/$/, '$1');

/**
 * Frame of a path under the group's link. The menu shows under the two tabs it leads to, the transfers included; my page, a member's sheet and the
 * forms take the whole screen with their own bar, a sheet opening from several screens, which its arrow leads back to. An unknown path keeps the
 * group's band, nothing filling a screen's own.
 */
export function chromeOf(location: string): Chrome {
  const path = trimmed(location);
  if (path === '/soldes' || path.startsWith('/soldes/')) {
    return { section: 'balances', nav: true, screenBar: path === '/soldes/virements' };
  }
  if (path === '/moi' || path === '/moi/groupe') {
    return { section: path === '/moi' ? 'me' : 'members', nav: false, screenBar: true };
  }
  if (/^\/membres\/[^/]+$/.test(path)) {
    return { section: 'sheet', nav: false, screenBar: true };
  }
  if (/^\/(nouvelle-depense|nouveau-remboursement|operations\/[^/]+\/modifier)$/.test(path)) {
    return { section: 'form', nav: false, screenBar: true };
  }
  return { section: 'operations', nav: true, screenBar: false };
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
