import { type ReactNode, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { groupLink } from '../model/link.ts';
import styles from './GroupHome.module.css';
import layout from './Layout.module.css';
import field from './PasteLink.module.css';

type Outcome = 'copied' | 'manual';

/**
 * Hands the group's link on: the phone's share sheet where the browser has one, otherwise a copy to the clipboard, and as a last resort the link
 * shown to copy by hand. The link is the only key to the group and the server keeps only its hash, so the members are the ones who pass it on.
 */
export function ShareLink({ token, title }: { readonly token: string; readonly title: string }): ReactNode {
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const link = groupLink(window.location.origin, token);

  async function share() {
    setOutcome(undefined);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: m.share_text({ title }), url: link });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure; any other refusal (no user gesture left, sharing blocked) falls back to the copy.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setOutcome('copied');
    } catch {
      setOutcome('manual');
    }
  }

  return (
    <div className={styles.share}>
      <button className={layout.link} type="button" onClick={() => void share()}>
        {m.share_link()}
      </button>
      {outcome === 'copied' ? (
        <p role="status" className={layout.muted}>
          {m.share_copied()}
        </p>
      ) : null}
      {outcome === 'manual' ? (
        <label className={styles.shareManual}>
          {m.share_manual()}
          <input
            className={field.input}
            readOnly
            value={link}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
