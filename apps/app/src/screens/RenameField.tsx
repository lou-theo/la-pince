import { type ReactNode, useEffect, useRef, useState } from 'react';

import { editErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { CloseIcon } from './FormFrame.tsx';
import styles from './RenameField.module.css';
import { useMounted } from './useMounted.ts';
import type { EditResult } from './view.ts';

interface RenameFieldProps {
  /** The text as stored, never the name marked « (toi) ». */
  readonly value: string;
  readonly maxLength: number;
  /** Name of the pencil: « Renommer Capucine ». */
  readonly label: string;
  /** Name of the field: « Prénom ». */
  readonly field: string;
  /** Whether another member already has the text, which the server would refuse. */
  readonly taken?: (text: string) => boolean;
  readonly online: boolean;
  readonly onSave: (text: string) => Promise<EditResult>;
  /** The text as shown, beside the pencil. */
  readonly children: ReactNode;
  /** The text and its pencil at the middle of their line. */
  readonly centered?: boolean;
}

/**
 * A text renamed in place: the pencil opens a field holding it; Enter or the check sends it, Escape or the cross gives up, leaving the field does
 * nothing, so that a touch beside it loses nothing. An unchanged text closes without a request; a failure keeps what was typed, said below.
 */
export function RenameField({ value, maxLength, label, field, taken, online, onSave, children, centered = false }: RenameFieldProps): ReactNode {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  // The pencil gets the focus back once the field closes, not when the screen opens.
  const closed = useRef(false);
  const mounted = useMounted();

  useEffect(() => {
    if (draft === undefined && closed.current) {
      closed.current = false;
      pencil.current?.focus();
    }
  }, [draft]);

  if (draft === undefined) {
    return (
      <div className={centered ? `${styles.shown ?? ''} ${styles.centered ?? ''}` : styles.shown}>
        {children}
        <button
          ref={pencil}
          className={styles.icon}
          type="button"
          aria-label={label}
          disabled={!online}
          onClick={() => {
            setDraft(value);
            setError(undefined);
          }}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  const close = () => {
    closed.current = true;
    setDraft(undefined);
    setError(undefined);
  };
  // Once sent, the edit goes through whatever the person does: closing then would look like cancelling it.
  const cancel = () => {
    if (!busy) {
      close();
    }
  };
  const text = draft.trim();
  const isTaken = text !== value.trim() && taken?.(text) === true;
  const blocked = busy || !online || text === '' || isTaken;
  const message = isTaken ? m.error_member_name_taken() : error;

  const save = async () => {
    if (text === value.trim()) {
      close();
      return;
    }
    if (blocked) {
      return;
    }
    setBusy(true);
    const result = await onSave(text);
    if (!mounted.current) {
      return;
    }
    setBusy(false);
    if (result.ok) {
      close();
    } else {
      setError(editErrorMessage(result.error));
    }
  };

  return (
    <form
      className={styles.editing}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.row}>
        <input
          className={styles.input}
          type="text"
          aria-label={field}
          aria-invalid={message === undefined ? undefined : true}
          value={draft}
          maxLength={maxLength}
          autoComplete="off"
          // Opened by a touch on the pencil: the field is what the person wants to type in.
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
        />
        <button className={`${styles.icon ?? ''} ${styles.save ?? ''}`} type="submit" aria-label={m.rename_save()} aria-disabled={blocked}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
        <button className={styles.icon} type="button" aria-label={m.rename_cancel()} aria-disabled={busy} onClick={cancel}>
          <CloseIcon />
        </button>
      </div>
      {busy ? <p className={styles.note}>{m.edit_sending()}</p> : null}
      {message === undefined ? null : (
        <p className={styles.error} role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

function PencilIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </svg>
  );
}
