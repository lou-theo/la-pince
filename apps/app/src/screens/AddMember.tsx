import { MAX_MEMBER_NAME_LENGTH, type MemberId, memberIdSchema, type NewMember } from '@la-pince/core';
import { type ReactNode, useId, useRef, useState } from 'react';

import { editErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { CloseIcon } from './FormFrame.tsx';
import styles from './Me.module.css';
import { useMounted } from './useMounted.ts';
import type { EditResult } from './view.ts';

interface AddMemberProps {
  readonly online: boolean;
  /** Whether another member than `self` already has the name, which the server would refuse. */
  readonly taken: (name: string, self: MemberId | undefined) => boolean;
  readonly onAdd: (member: NewMember) => Promise<EditResult>;
}

/**
 * “Ajouter un membre” and the sheet it opens from the bottom, a native modal dialog: a first name and “Ajouter au groupe”. Escape, a touch on the
 * backdrop or the cross close it without asking, what was typed being short; it closes too once the member is added. The member's id is drawn when
 * it opens and sent again with each try, so that a request whose answer was lost finds the member it created; a new opening draws a new one.
 */
export function AddMember({ online, taken, onAdd }: AddMemberProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();
  const offlineId = useId();
  // The id of the sheet open now: an answer for a sheet closed meanwhile must not close, nor unblock, the next one.
  const current = useRef<MemberId>(undefined);
  // Where the press began: a text selection released over the backdrop is not a touch on it.
  const pressedBackdrop = useRef(false);
  const [id, setId] = useState<MemberId>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();

  const name = draft.trim();
  // The member of this sheet, made by a try whose answer was lost, does not block the try that finds it.
  const isTaken = name !== '' && taken(name, id);
  const blocked = busy || !online || name === '' || isTaken;
  const message = isTaken ? m.error_member_name_taken() : error;

  const open = () => {
    const drawn = memberIdSchema.parse(crypto.randomUUID());
    current.current = drawn;
    setId(drawn);
    setBusy(false);
    setDraft('');
    setError(undefined);
    dialog.current?.showModal();
    field.current?.focus();
  };
  const close = () => {
    dialog.current?.close();
  };
  const add = async () => {
    if (blocked || id === undefined) {
      return;
    }
    setBusy(true);
    const result = await onAdd({ id, name });
    if (!mounted.current || current.current !== id) {
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
    <>
      <button ref={opener} className={styles.addMember} type="button" disabled={!online} onClick={open}>
        <svg className={styles.plus} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {m.members_add()}
      </button>
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-labelledby={titleId}
        onClose={() => {
          current.current = undefined;
          setId(undefined);
          // Browsers give the focus back to the button by themselves; a test environment may not.
          opener.current?.focus();
        }}
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === dialog.current;
        }}
        onClick={(event) => {
          // A touch on the backdrop lands on the dialog itself, its content filling the sheet.
          if (pressedBackdrop.current && event.target === dialog.current) {
            close();
          }
        }}
      >
        <form
          className={styles.sheetContent}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <span className={styles.handle} aria-hidden="true" />
          <div className={styles.sheetHead}>
            <h2 id={titleId} className={styles.sheetTitle}>
              {m.add_member_title()}
            </h2>
            <button className={styles.close} type="button" aria-label={m.form_close()} onClick={close}>
              <CloseIcon />
            </button>
          </div>
          <label className={styles.field}>
            {m.rename_name()}
            <input
              ref={field}
              className={styles.input}
              type="text"
              placeholder={m.rename_name()}
              value={draft}
              maxLength={MAX_MEMBER_NAME_LENGTH}
              autoComplete="off"
              aria-invalid={message === undefined ? undefined : true}
              aria-describedby={hintId}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(undefined);
              }}
            />
          </label>
          {message === undefined ? null : (
            <p className={styles.error} role="alert">
              {message}
            </p>
          )}
          <p id={hintId} className={styles.hint}>
            {m.add_member_hint()}
          </p>
          {online || id === undefined ? null : (
            <p id={offlineId} className={styles.error} role="status">
              {m.edit_offline()}
            </p>
          )}
          <button className={styles.submit} type="submit" aria-disabled={blocked} aria-describedby={online ? undefined : offlineId}>
            {busy ? m.add_member_sending() : m.add_member_submit()}
          </button>
        </form>
      </dialog>
    </>
  );
}
