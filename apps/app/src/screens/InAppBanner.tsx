import { type ReactNode, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { browserInstallPlatform, type InstallPlatform } from '../install/platform.ts';
import { detectInstallContext } from '../model/install.ts';
import { groupLink } from '../model/link.ts';
import { hideInAppBanner, wasInAppBannerHidden } from '../storage/device.ts';
import styles from './Install.module.css';

type Copy = 'copied' | 'manual';

interface InAppBannerProps {
  readonly token: string;
  /** The browser's APIs by default; tests hand a fake one. */
  readonly platform?: InstallPlatform;
}

/**
 * Above the group in a browser built into a messaging or social app, which cannot install the app: to open the link in the phone's browser,
 * copied from here. Discreet, the group staying in reach, and hidden on demand for the page's session. Nothing anywhere else.
 */
export function InAppBanner({ token, platform }: InAppBannerProps): ReactNode {
  const [inApp] = useState(() => detectInstallContext((platform ?? browserInstallPlatform()).environment()) === 'in_app');
  const [hidden, setHidden] = useState(wasInAppBannerHidden);
  const [copy, setCopy] = useState<Copy | undefined>(undefined);
  const link = groupLink(window.location.origin, token);

  if (!inApp || hidden) {
    return null;
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      // Some web views refuse the clipboard: the link is shown to copy by hand.
      setCopy('manual');
    }
  };

  return (
    <aside className={styles.banner} aria-label={m.install_in_app_label()}>
      <img className={styles.peek} src="/logo.svg" alt="" />
      <div className={styles.bannerBody}>
        <p className={styles.bannerText} aria-live="polite">
          {copy === 'copied' ? m.install_in_app_paste() : copy === 'manual' ? m.install_in_app_manual() : m.install_in_app_text()}
        </p>
        {copy === 'manual' ? (
          <input
            className={styles.manual}
            aria-label={m.install_in_app_manual()}
            readOnly
            value={link}
            onFocus={(event) => {
              // `select()` leaves nothing selected on iOS Safari.
              event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
            }}
          />
        ) : (
          <button
            className={copy === 'copied' ? `${styles.copy ?? ''} ${styles.copied ?? ''}` : styles.copy}
            type="button"
            onClick={() => void copyLink()}
          >
            {copy === 'copied' ? m.install_in_app_copied() : m.install_in_app_copy()}
          </button>
        )}
      </div>
      <button
        className={styles.close}
        type="button"
        aria-label={m.install_in_app_hide()}
        onClick={() => {
          hideInAppBanner();
          setHidden(true);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}
