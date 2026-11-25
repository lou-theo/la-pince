import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';

import styles from './Band.module.css';

/** How long a band offering to undo stays: what it undoes is never serious, and can be undone by other means afterwards. */
export const BAND_DURATION = 15_000;

/** What a band shows, gone after `BAND_DURATION`, earlier with its screen; a new value replaces it and starts the time again. */
export function useBand<T>(): [T | undefined, Dispatch<SetStateAction<T | undefined>>] {
  const [band, setBand] = useState<T>();
  useEffect(() => {
    if (band === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setBand(undefined);
    }, BAND_DURATION);
    return () => {
      clearTimeout(timer);
    };
  }, [band]);
  return [band, setBand];
}

interface BandProps {
  /** The lines of the band: a title, then details. */
  readonly children: ReactNode;
  /** The button at its end, “Annuler”. */
  readonly action?: { readonly text: string; readonly label: string; readonly disabled: boolean; readonly onClick: () => void };
  /** Whether the screen has the menu at the bottom, which the band sticks above. */
  readonly nav: boolean;
  /** A failure, said at once by a screen reader. */
  readonly alert?: boolean;
}

/**
 * A band at the bottom of a screen, after an action that can be undone. It follows the screen in the flow, sticking above the menu or the bottom
 * of the screen: at the end of the screen it sits below the last line.
 */
export function Band({ children, action, nav, alert = false }: BandProps): ReactNode {
  return (
    <div className={nav ? `${styles.band ?? ''} ${styles.withNav ?? ''}` : styles.band} role={alert ? 'alert' : 'status'}>
      <p className={styles.text}>{children}</p>
      {action === undefined ? null : (
        <button className={styles.action} type="button" aria-label={action.label} disabled={action.disabled} onClick={action.onClick}>
          {action.text}
        </button>
      )}
    </div>
  );
}

/** The first line of a band, in bold. */
export function BandTitle({ children }: { readonly children: ReactNode }): ReactNode {
  return <strong className={styles.title}>{children}</strong>;
}

/** A line of a band after its title, cut by an ellipsis when too long. */
export function BandDetail({ children, alert = false }: { readonly children: ReactNode; readonly alert?: boolean }): ReactNode {
  return (
    <span className={styles.detail} role={alert ? 'alert' : undefined}>
      {children}
    </span>
  );
}
