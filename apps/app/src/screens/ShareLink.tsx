import { type ReactNode, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { groupLink } from '../model/link.ts';
import layout from './Layout.module.css';
import styles from './ShareLink.module.css';

type Outcome = 'copied' | 'manual';

/**
 * Hands the group's link on: the phone's share sheet where the browser has one, otherwise a copy to the clipboard, and as a last resort the link
 * shown to copy by hand. The link is the only key to the group and the server keeps only its hash, so the members are the ones who pass it on.
 */
export function ShareLink({ token, title }: { readonly token: string; readonly title: string }): ReactNode {
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  // A second press while the sheet is open is refused by the browser (InvalidStateError), which must not fall back to a copy.
  const busy = useRef(false);
  const link = groupLink(window.location.origin, token);

  async function share() {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setOutcome(undefined);
    try {
      setOutcome(await deliver());
    } finally {
      busy.current = false;
    }
  }

  async function deliver(): Promise<Outcome | undefined> {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: m.share_text({ title }), url: link });
        return undefined;
      } catch (error) {
        // Closing the sheet is a choice, not a failure; any other refusal (no user gesture left, sharing blocked) falls back to the copy.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return undefined;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      return 'copied';
    } catch {
      return 'manual';
    }
  }

  return (
    <div className={styles.share}>
      <button className={layout.iconButton} type="button" aria-label={m.share_link()} onClick={() => void share()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
      </button>
      {/* Always rendered, only its text changing: a live region inserted already filled is announced unevenly, VoiceOver included. */}
      <p className={`${layout.muted ?? ''} ${styles.status ?? ''}`} aria-live="polite">
        {outcome === 'copied' ? m.share_copied() : outcome === 'manual' ? m.share_manual() : null}
      </p>
      {outcome === 'manual' ? (
        <input
          className={styles.input}
          aria-label={m.share_manual()}
          readOnly
          value={link}
          onFocus={(event) => {
            // `select()` leaves nothing selected on iOS Safari.
            event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
          }}
        />
      ) : null}
    </div>
  );
}
