import { revisionIdSchema } from '@la-pince/core';
import { type ReactNode, type RefObject, type SubmitEvent, useEffect, useId, useReducer, useRef, useState } from 'react';
import { useLocation } from 'wouter';

import { queueErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { formatCents } from '../model/money.ts';
import { type FormAction, type FormErrors, formReducer, type FormState, hasChanged, readForm, typedCents, typedSum } from '../model/operationForm.ts';
import type { QueueError } from '../sync/groupStore.ts';
import layout from './Layout.module.css';
import { ScreenBar } from './Layout.tsx';
import styles from './OperationForm.module.css';
import { useMounted } from './useMounted.ts';
import type { GroupView } from './view.ts';

// Reads made only for their errors: this identifier is never sent.
const draft = revisionIdSchema.parse('draft');

/** What the form of an operation shares with every form: its state, its errors once a save was tried, saving and leaving. */
export interface OperationFormFrame {
  readonly state: FormState;
  readonly dispatch: (action: FormAction) => void;
  /** Whether the form reads as an operation, which greys the button while it does not. */
  readonly valid: boolean;
  readonly errors: FormErrors;
  readonly formId: string;
  readonly save: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly sending: boolean;
  readonly queueError: QueueError | undefined;
  readonly close: () => void;
  /** Whether the person is asked to discard what they typed, and the answers. */
  readonly closing: boolean;
  readonly discard: () => void;
  readonly keep: () => void;
}

/**
 * The state of an operation's form, saved as a new revision by who I am, then the operation's detail; `back` is where closing it leads, and
 * `formRef` the form whose first field in error takes the focus.
 */
export function useOperationForm(view: GroupView, initial: FormState, back: string, formRef: RefObject<HTMLFormElement | null>): OperationFormFrame {
  const [state, dispatch] = useReducer(formReducer, initial);
  // As opened: a parent may pass a new `initial` when the group is read again, which is not a change made here.
  const [opened] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [queueError, setQueueError] = useState<QueueError>();
  const [, navigate] = useLocation();
  const mounted = useMounted();
  const formId = useId();

  const read = readForm(state, { revisionId: draft, author: view.me });

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    // Each send is a new revision, its identifier drawn here.
    const operation = readForm(state, { revisionId: revisionIdSchema.parse(crypto.randomUUID()), author: view.me });
    if (!operation.ok) {
      // The messages appear under their fields, maybe out of sight on a phone: the first field in error takes the focus.
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby]')?.focus();
      });
      return;
    }
    if (sending) {
      return;
    }
    setSending(true);
    setQueueError(undefined);
    // Queued on the phone and shown at once; the outbox sends it whenever the server answers.
    const result = await view.enqueue(operation.value);
    if (!mounted.current) {
      return;
    }
    setSending(false);
    if (result.ok) {
      navigate(`/operations/${state.id}`, { replace: true });
    } else {
      setQueueError(result.error);
    }
  };

  return {
    state,
    dispatch,
    valid: read.ok,
    // Errors wait for a first attempt to save, so that an empty form does not open in red.
    errors: submitted && !read.ok ? read.errors : {},
    formId,
    save: (event) => void save(event),
    sending,
    queueError,
    close: () => {
      // What was typed is lost on leaving: asked first, as a deletion is. The browser's back is not held back.
      if (hasChanged(opened, state)) {
        setClosing(true);
      } else {
        navigate(back);
      }
    },
    closing,
    discard: () => {
      navigate(back);
    },
    keep: () => {
      setClosing(false);
    },
  };
}

/** The band of a form: the cross that closes it, its title, and the button that saves it, out of the form and tied to it by `form`. */
export function FormBar({
  frame,
  heading,
  action,
}: {
  readonly frame: OperationFormFrame;
  readonly heading: string;
  readonly action: string;
}): ReactNode {
  return (
    <>
      <ScreenBar>
        <button className={layout.iconButton} type="button" aria-label={m.form_close()} disabled={frame.sending} onClick={frame.close}>
          <CloseIcon />
        </button>
        <h1 className={`${layout.name ?? ''} ${styles.heading ?? ''}`} title={heading}>
          {heading}
        </h1>
        <button className={styles.save} type="submit" form={frame.formId} aria-disabled={!frame.valid} disabled={frame.sending}>
          {frame.sending ? m.form_saving() : action}
        </button>
      </ScreenBar>
      {frame.closing ? <Discard onDiscard={frame.discard} onKeep={frame.keep} /> : null}
    </>
  );
}

/** Why the outbox did not take the operation, under the form. */
export function QueueErrorLine({ error }: { readonly error: QueueError | undefined }): ReactNode {
  return error === undefined ? null : (
    <p className={layout.error} role="alert">
      {queueErrorMessage(error)}
    </p>
  );
}

/** The question asked before leaving a form whose content changed. */
function Discard({ onDiscard, onKeep }: { readonly onDiscard: () => void; readonly onKeep: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div className={styles.discard} role="alert">
      <p>{m.form_discard_confirm()}</p>
      <div className={layout.actions}>
        <button className={`${layout.button ?? ''} ${styles.danger ?? ''}`} type="button" onClick={onDiscard}>
          {m.form_discard_yes()}
        </button>
        <button ref={keep} className={layout.link} type="button" onClick={onKeep}>
          {m.form_discard_no()}
        </button>
      </div>
    </div>
  );
}

/** A field in its box, the label small above it, its error under the box. */
export function Box({
  id,
  label,
  error,
  money = false,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly error: string | undefined;
  readonly money?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={styles.field}>
      <div className={`${styles.box ?? ''} ${money ? (styles.moneyBox ?? '') : ''}`} data-invalid={error !== undefined}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        {children}
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}

export function FieldError({ id, error }: { readonly id: string; readonly error: string | undefined }): ReactNode {
  return error === undefined ? null : (
    <p id={`${id}-error`} className={`${layout.error ?? ''} ${styles.fieldError ?? ''}`}>
      {error}
    </p>
  );
}

export function CloseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Names a control by its box's label, and ties it to its message under the box. */
export function labelled(id: string, error: string | undefined): { 'aria-labelledby': string; 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return { 'aria-labelledby': `${id}-label`, ...invalid(id, error) };
}

/** Marks a field invalid and ties it to its message, rendered under the id `<id>-error`. */
export function invalid(id: string, error: string | undefined): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return error === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${id}-error` };
}

/** The date of an operation, its native field laid over the box that shows the day. */
export function DateInput({
  id,
  value,
  error,
  dispatch,
}: {
  readonly id: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly dispatch: (action: FormAction) => void;
}): ReactNode {
  return (
    <input
      id={id}
      className={styles.overlay}
      type="date"
      value={value}
      {...labelled(id, error)}
      onClick={(event) => {
        // On a computer, a click on the hidden field selects a part of the date instead of opening the calendar.
        try {
          event.currentTarget.showPicker();
        } catch {
          // Thrown without a user gesture or by a browser that lacks it: the field keeps its native behaviour.
        }
      }}
      onChange={(event) => {
        dispatch({ type: 'date', value: event.target.value });
      }}
    />
  );
}

/**
 * A box of fixed width showing a choice, its native control laid over it, invisible: a touch opens the phone's own picker. A long name is cut
 * in the box, whole in the control.
 */
export function Case({
  id,
  label,
  value,
  error,
  highlighted = false,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error?: string | undefined;
  readonly highlighted?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={styles.field}>
      <div className={`${styles.box ?? ''} ${styles.case ?? ''} ${highlighted ? (styles.highlighted ?? '') : ''}`} data-invalid={error !== undefined}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        <span className={styles.caseValue} aria-hidden="true">
          {value}
        </span>
        {children}
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}

// Records keyed by every error code: a new code cannot go without its message.
export function amountError(errors: FormErrors, state: FormState): string | undefined {
  const messages: Record<NonNullable<FormErrors['amount']>, () => string> = {
    required: m.form_error_amount_required,
    invalid: m.form_error_amount_invalid,
    zero: m.form_error_amount_zero,
    mismatch: () => m.form_error_amount_mismatch({ sum: formatCents(typedSum(state)), total: formatCents(typedCents(state.amount) ?? 0) }),
  };
  return errors.amount === undefined ? undefined : messages[errors.amount]();
}

export function splitError(errors: FormErrors, state: FormState): string | undefined {
  const messages: Record<NonNullable<FormErrors['split']>, () => string> = {
    none_checked: state.kind === 'reimbursement' ? m.form_error_no_receiver : m.form_error_none_checked,
    same_member: m.form_error_same_member,
    too_large: m.form_error_too_large,
    several_receivers: m.form_reimbursement_several,
  };
  return errors.split === undefined ? undefined : messages[errors.split]();
}
