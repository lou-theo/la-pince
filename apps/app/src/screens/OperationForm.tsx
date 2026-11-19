import { type Effect, type Member, type MemberId, revisionIdSchema } from '@la-pince/core';
import { type ReactNode, type SubmitEvent, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';

import { sendErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { selectionOrder } from '../model/members.ts';
import { formatCents } from '../model/money.ts';
import {
  type FormAction,
  type FormErrors,
  formReducer,
  type FormState,
  previewEffect,
  readForm,
  typedCents,
  typedSum,
} from '../model/operationForm.ts';
import type { SendError } from '../sync/groupStore.ts';
import layout from './Layout.module.css';
import styles from './OperationForm.module.css';
import { useMounted } from './useMounted.ts';
import type { GroupView } from './view.ts';

// Reads made only for their errors: this identifier is never sent.
const draft = revisionIdSchema.parse('draft');

interface OperationFormProps {
  readonly view: GroupView;
  readonly initial: FormState;
  /** Whether the operation is already saved: the title and the way back change. */
  readonly editing: boolean;
}

/** Form of an expense or a reimbursement, new or to modify; saved, it opens the operation's detail. */
export function OperationForm({ view, initial, editing }: OperationFormProps): ReactNode {
  const [state, dispatch] = useReducer(formReducer, initial);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError>();
  const [notReread, setNotReread] = useState(false);
  const [, navigate] = useLocation();
  const mounted = useMounted();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { title: useId(), amount: useId(), date: useId(), payer: useId(), receiver: useId(), split: useId() };

  const members = useMemo(() => selectionOrder(view.members, view.me, view.operations), [view.members, view.me, view.operations]);
  const preview = previewEffect(state);
  const read = readForm(state, { revisionId: draft, author: view.me });
  // Errors wait for a first attempt to save, so that an empty form does not open in red.
  const errors: FormErrors = submitted && !read.ok ? read.errors : {};
  const reimbursement = state.kind === 'reimbursement';
  const back = editing ? `/operations/${state.id}` : '/';

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    // Each send is a new revision, its identifier drawn here.
    const operation = readForm(state, { revisionId: revisionIdSchema.parse(crypto.randomUUID()), author: view.me });
    if (!operation.ok) {
      // The messages appear under their fields, maybe out of sight on a phone: the first field in error takes the focus.
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    if (sending) {
      return;
    }
    setSending(true);
    setSendError(undefined);
    setNotReread(false);
    const result = await view.send(operation.value);
    if (!mounted.current) {
      return;
    }
    setSending(false);
    if (!result.ok) {
      setSendError(result.error);
    } else if (result.reread) {
      navigate(`/operations/${state.id}`, { replace: true });
    } else {
      // Written but not read back: the detail would not know it yet. Saving again sends a revision of the same operation, never a duplicate.
      setNotReread(true);
    }
  };

  const heading = reimbursement
    ? editing
      ? m.form_edit_reimbursement()
      : m.form_new_reimbursement()
    : editing
      ? m.form_edit_expense()
      : m.form_new_expense();

  return (
    <form ref={formRef} className={styles.form} onSubmit={(event) => void save(event)} noValidate>
      <h2 className={layout.title}>{heading}</h2>
      <Field id={ids.title} label={m.form_title()} error={titleError(errors)}>
        <input
          id={ids.title}
          className={styles.input}
          type="text"
          autoComplete="off"
          maxLength={100}
          value={state.title}
          {...invalid(ids.title, titleError(errors))}
          onChange={(event) => {
            dispatch({ type: 'title', value: event.target.value });
          }}
        />
      </Field>
      <Field
        id={ids.amount}
        label={!reimbursement && state.mode === 'amounts' ? m.form_control_total() : m.form_amount()}
        error={amountError(errors, state)}
      >
        <input
          id={ids.amount}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={state.amount}
          {...invalid(ids.amount, amountError(errors, state))}
          onChange={(event) => {
            dispatch({ type: 'amount', value: event.target.value });
          }}
        />
      </Field>
      <Field id={ids.date} label={m.form_date()} error={errors.date === undefined ? undefined : m.form_error_date_invalid()}>
        <input
          id={ids.date}
          className={styles.input}
          type="date"
          value={state.date}
          {...invalid(ids.date, errors.date)}
          onChange={(event) => {
            dispatch({ type: 'date', value: event.target.value });
          }}
        />
      </Field>
      <Field id={ids.payer} label={reimbursement ? m.form_from() : m.form_payer()}>
        <MemberSelect
          id={ids.payer}
          members={members}
          view={view}
          value={state.payer}
          onChange={(member) => {
            dispatch({ type: 'payer', member });
          }}
        />
      </Field>
      {reimbursement ? (
        <Field id={ids.receiver} label={m.form_to()} error={splitError(errors, state)}>
          <MemberSelect
            id={ids.receiver}
            members={members}
            view={view}
            value={state.checked[0]}
            error={splitError(errors, state)}
            onChange={(member) => {
              dispatch({ type: 'receiver', member });
            }}
          />
        </Field>
      ) : (
        <Split view={view} members={members} state={state} errors={errors} preview={preview} dispatch={dispatch} splitId={ids.split} />
      )}
      {sendError === undefined ? null : (
        <p className={layout.error} role="alert">
          {sendErrorMessage(sendError)}
        </p>
      )}
      {notReread ? (
        <p className={layout.error} role="alert">
          {m.form_saved_not_read()}
        </p>
      ) : null}
      <div className={layout.actions}>
        <button className={layout.button} type="submit" disabled={sending}>
          {sending ? m.form_saving() : m.form_save()}
        </button>
        {/* A send cannot be taken back: no way to cancel it. */}
        {sending ? null : (
          <Link className={layout.link} href={back}>
            {m.form_cancel()}
          </Link>
        )}
      </div>
    </form>
  );
}

interface SplitProps {
  readonly view: GroupView;
  readonly members: readonly Member[];
  readonly state: FormState;
  readonly errors: FormErrors;
  readonly preview: Effect | undefined;
  readonly dispatch: (action: FormAction) => void;
  readonly splitId: string;
}

/** Who shares an expense: checked members for an equal split, with each share previewed; an amount per member otherwise. */
function Split({ view, members, state, errors, preview, dispatch, splitId }: SplitProps) {
  const error = splitError(errors, state);
  const errorId = `${splitId}-error`;
  const sum = typedSum(state);
  const total = state.mode === 'amounts' ? typedCents(state.amount) : undefined;
  return (
    <fieldset className={styles.split} aria-describedby={error === undefined ? undefined : errorId}>
      <legend className={styles.legend}>{m.form_split()}</legend>
      <div className={styles.modes}>
        {(['equal', 'amounts'] as const).map((mode) => (
          <button
            key={mode}
            className={styles.mode}
            type="button"
            aria-pressed={state.mode === mode}
            onClick={() => {
              dispatch({ type: 'mode', mode });
            }}
          >
            {mode === 'equal' ? m.form_mode_equal() : m.form_mode_amounts()}
          </button>
        ))}
      </div>
      {state.mode === 'equal' ? (
        <>
          <div className={styles.modes}>
            <button
              className={layout.link}
              type="button"
              onClick={() => {
                dispatch({ type: 'checkAll', members: members.map((member) => member.id) });
              }}
            >
              {m.form_check_all()}
            </button>
            <button
              className={layout.link}
              type="button"
              onClick={() => {
                dispatch({ type: 'uncheckAll' });
              }}
            >
              {m.form_uncheck_all()}
            </button>
          </div>
          <ul className={styles.members}>
            {members.map((member) => {
              const share = preview?.shares.find((candidate) => candidate.member === member.id)?.amount;
              return (
                <li key={member.id}>
                  <label className={styles.member}>
                    <input
                      type="checkbox"
                      checked={state.checked.includes(member.id)}
                      onChange={() => {
                        dispatch({ type: 'toggle', member: member.id });
                      }}
                    />
                    <span className={styles.name}>{view.nameOf(member.id)}</span>
                    <span className={styles.share}>{share === undefined ? '' : formatCents(share)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <ul className={styles.members}>
            {members.map((member) => {
              const unreadable = errors.amounts?.includes(member.id) === true;
              const inputId = `${splitId}-${member.id}`;
              return (
                <li key={member.id} className={styles.member}>
                  <label className={styles.name} htmlFor={inputId}>
                    {view.nameOf(member.id)}
                  </label>
                  <input
                    id={inputId}
                    className={`${styles.input ?? ''} ${styles.amount ?? ''}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={m.form_amount_of({ name: view.nameOf(member.id) })}
                    value={state.amounts[member.id] ?? ''}
                    {...invalid(inputId, unreadable ? m.form_error_member_amount() : undefined)}
                    onChange={(event) => {
                      dispatch({ type: 'memberAmount', member: member.id, value: event.target.value });
                    }}
                  />
                  {unreadable ? (
                    <p id={`${inputId}-error`} className={`${layout.error ?? ''} ${styles.memberError ?? ''}`}>
                      {m.form_error_member_amount()}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className={layout.muted} aria-live="polite">
            {m.form_sum({ sum: formatCents(sum) })}
            {total === undefined || total === sum ? null : ` · ${m.form_left({ amount: formatCents(total - sum) })}`}
          </p>
        </>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={layout.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface MemberSelectProps {
  readonly id: string;
  readonly members: readonly Member[];
  readonly view: GroupView;
  readonly value: MemberId | undefined;
  readonly error?: string | undefined;
  readonly onChange: (member: MemberId) => void;
}

function MemberSelect({ id, members, view, value, error, onChange }: MemberSelectProps) {
  return (
    <select
      id={id}
      className={styles.input}
      value={value ?? ''}
      {...invalid(id, error)}
      onChange={(event) => {
        const member = members.find((candidate) => candidate.id === event.target.value);
        if (member !== undefined) {
          onChange(member.id);
        }
      }}
    >
      {value === undefined ? (
        <option value="" disabled>
          {m.form_to_placeholder()}
        </option>
      ) : null}
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {view.nameOf(member.id)}
        </option>
      ))}
    </select>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error === undefined ? null : (
        <p id={`${id}-error`} className={layout.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Marks a field invalid and ties it to its message, which `Field` renders under the id `<id>-error`. */
function invalid(id: string, error: string | undefined) {
  return error === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${id}-error` };
}

// Records keyed by every error code: a new code cannot go without its message.
const titleMessages: Record<NonNullable<FormErrors['title']>, () => string> = {
  required: m.form_error_title_required,
  too_long: m.form_error_title_too_long,
};

function titleError(errors: FormErrors): string | undefined {
  return errors.title === undefined ? undefined : titleMessages[errors.title]();
}

function amountError(errors: FormErrors, state: FormState): string | undefined {
  const messages: Record<NonNullable<FormErrors['amount']>, () => string> = {
    required: m.form_error_amount_required,
    invalid: m.form_error_amount_invalid,
    zero: m.form_error_amount_zero,
    mismatch: () => m.form_error_amount_mismatch({ sum: formatCents(typedSum(state)), total: formatCents(typedCents(state.amount) ?? 0) }),
  };
  return errors.amount === undefined ? undefined : messages[errors.amount]();
}

function splitError(errors: FormErrors, state: FormState): string | undefined {
  const messages: Record<NonNullable<FormErrors['split']>, () => string> = {
    none_checked: state.kind === 'reimbursement' ? m.form_error_no_receiver : m.form_error_none_checked,
    no_amount: m.form_error_no_amount,
    same_member: m.form_error_same_member,
    too_large: m.form_error_too_large,
    several_receivers: m.form_reimbursement_several,
  };
  return errors.split === undefined ? undefined : messages[errors.split]();
}
