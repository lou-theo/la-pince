import { type ReactNode, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { chromeIntentUrl } from '../model/install.ts';
import styles from './Install.module.css';

type Copy = 'copied' | 'failed';

/**
 * The word of a browser that cannot install the app: La Pince recommends Chrome, opened on this page by an `intent:` link, the link to copy for
 * where it does not open; a shortcut is still offered, said to be less good. A Chromium browser that handed no install window may have installed
 * the app already: `maybeInstalled` says where to find it.
 */
export function CannotInstall({ maybeInstalled, onShortcut }: { readonly maybeInstalled: boolean; readonly onShortcut: () => void }): ReactNode {
  const [copy, setCopy] = useState<Copy | undefined>(undefined);
  const page = location.href;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(page);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <div className={styles.cannot}>
      <div className={styles.hero} aria-hidden="true">
        <span className={styles.halo} />
        <span className={styles.hop}>
          <img className={styles.bob} src="/logo.svg" alt="" />
        </span>
      </div>
      <h3 className={styles.cannotTitle}>{m.install_cannot_title()}</h3>
      <p className={styles.offerText}>{m.install_cannot_recommend()}</p>
      {maybeInstalled ? <p className={`${styles.muted ?? ''} ${styles.shortcutNote ?? ''}`}>{m.install_menu_already()}</p> : null}
      <a className={`${styles.primary ?? ''} ${styles.start ?? ''}`} href={chromeIntentUrl(page)}>
        {m.install_cannot_open_chrome()}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
      {/* Always there, only its words changing, for a screen reader to tell the copy. */}
      <div aria-live="polite">
        <button className={styles.copy} type="button" onClick={() => void copyLink()}>
          {copy === 'copied' ? m.install_cannot_copied() : copy === 'failed' ? m.install_cannot_copy_failed() : m.install_cannot_copy()}
        </button>
      </div>
      <button className={`${styles.secondary ?? ''} ${styles.shortcut ?? ''}`} type="button" onClick={onShortcut}>
        {m.install_cannot_shortcut()}
      </button>
      <p className={`${styles.muted ?? ''} ${styles.shortcutNote ?? ''}`}>{m.install_cannot_shortcut_note()}</p>
    </div>
  );
}
