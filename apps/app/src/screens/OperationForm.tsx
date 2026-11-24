import { type Member, type MemberId, revisionIdSchema } from '@la-pince/core';
import { type ReactNode, type SubmitEvent, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation } from 'wouter';

import { queueErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { localDay, shortDay } from '../model/dates.ts';
import { selectionOrder } from '../model/members.ts';
import { centsToInput, formatCents } from '../model/money.ts';
import {
  type FormAction,
  type FormErrors,
  formReducer,
  type FormState,
  hasChanged,
  readForm,
  type SplitMode,
  splitStatus,
  typedCents,
  typedSum,
} from '../model/operationForm.ts';
import type { QueueError } from '../sync/groupStore.ts';
import { Avatar } from './Avatar.tsx';
import layout from './Layout.module.css';
import { FormBar } from './Layout.tsx';
import styles from './OperationForm.module.css';
import { useMounted } from './useMounted.ts';
import type { GroupView } from './view.ts';

// Reads made only for their errors: this identifier is never sent.
const draft = revisionIdSchema.parse('draft');

interface OperationFormProps {
  readonly view: GroupView;
  readonly initial: FormState;
  /** Whether the operation is already saved: the title, the button and the way back change. */
  readonly editing: boolean;
}

/** Form of an expense or a reimbursement, new or to modify, on the whole screen; saved, it opens the operation's detail. */
export function OperationForm({ view, initial, editing }: OperationFormProps): ReactNode {
  const [state, dispatch] = useReducer(formReducer, initial);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [queueError, setQueueError] = useState<QueueError>();
  // The day the box of the date reads from: today, yesterday.
  const [today] = useState(() => localDay(new Date()));
  const [, navigate] = useLocation();
  const mounted = useMounted();
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const ids = { title: useId(), amount: useId(), date: useId(), payer: useId(), receiver: useId(), mode: useId(), split: useId() };

  const members = useMemo(() => selectionOrder(view.members, view.me, view.operations), [view.members, view.me, view.operations]);
  const read = readForm(state, { revisionId: draft, author: view.me });
  // Errors wait for a first attempt to save, so that an empty form does not open in red.
  const errors: FormErrors = submitted && !read.ok ? read.errors : {};
  const reimbursement = state.kind === 'reimbursement';
  const back = editing ? `/operations/${state.id}` : '/';
  // Who I am is “Toi” in the narrow places of the form, a member's full name being in the labels.
  const shortName = (id: MemberId) => (id === view.me ? m.form_you() : (view.members.find((member) => member.id === id)?.name ?? id));

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

  const close = () => {
    // What was typed is lost on leaving: asked first, as a deletion is. The browser's back is not held back.
    if (hasChanged(initial, state)) {
      setClosing(true);
    } else {
      navigate(back);
    }
  };

  const heading = reimbursement
    ? editing
      ? m.form_edit_reimbursement()
      : m.form_new_reimbursement()
    : editing
      ? m.form_edit_expense()
      : m.form_new_expense();
  const amountsMode = !reimbursement && state.mode === 'amounts';

  return (
    <>
      <FormBar>
        <button className={layout.iconButton} type="button" aria-label={m.form_close()} disabled={sending} onClick={close}>
          <CloseIcon />
        </button>
        <h1 className={layout.name}>{heading}</h1>
        {/* Out of the form, in the band: tied to it by `form`. Greyed while the form has an error, a touch still shows the errors. */}
        <button className={styles.save} type="submit" form={formId} aria-disabled={!read.ok} disabled={sending}>
          {sending ? m.form_saving() : editing ? m.form_save() : m.form_add()}
        </button>
      </FormBar>
      {closing ? (
        <Discard
          onDiscard={() => {
            navigate(back);
          }}
          onKeep={() => {
            setClosing(false);
          }}
        />
      ) : null}
      <form id={formId} ref={formRef} className={styles.form} onSubmit={(event) => void save(event)} noValidate>
        <div className={styles.top}>
          <Box id={ids.title} label={m.form_title()} error={titleError(errors)}>
            <input
              id={ids.title}
              className={styles.input}
              type="text"
              autoComplete="off"
              maxLength={100}
              value={state.title}
              {...labelled(ids.title, titleError(errors))}
              onChange={(event) => {
                dispatch({ type: 'title', value: event.target.value });
              }}
            />
          </Box>
          <Box
            id={ids.amount}
            label={amountsMode ? (state.amount.trim() === '' ? m.form_computed_total() : m.form_control_total()) : m.form_amount()}
            error={amountError(errors, state)}
            money
          >
            <input
              id={ids.amount}
              className={`${styles.input ?? ''} ${styles.money ?? ''}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              // Without a control total, the amounts make it: shown as it will be saved.
              placeholder={amountsMode ? centsToInput(typedSum(state)) : '0,00'}
              value={state.amount}
              {...labelled(ids.amount, amountError(errors, state))}
              onChange={(event) => {
                dispatch({ type: 'amount', value: event.target.value });
              }}
            />
          </Box>
        </div>
        <div className={styles.cases}>
          <Case id={ids.payer} label={reimbursement ? m.form_from() : m.form_payer()} value={shortName(state.payer)}>
            <MemberSelect
              id={ids.payer}
              members={members}
              value={state.payer}
              nameOf={shortName}
              onChange={(member) => {
                dispatch({ type: 'payer', member });
              }}
            />
          </Case>
          {reimbursement ? (
            <Case
              id={ids.receiver}
              label={m.form_to()}
              value={state.checked[0] === undefined ? m.form_to_placeholder() : shortName(state.checked[0])}
              error={splitError(errors, state)}
            >
              <MemberSelect
                id={ids.receiver}
                members={members}
                value={state.checked[0]}
                nameOf={shortName}
                error={splitError(errors, state)}
                onChange={(member) => {
                  dispatch({ type: 'receiver', member });
                }}
              />
            </Case>
          ) : null}
          <Case
            id={ids.date}
            label={m.form_date()}
            value={state.date === '' ? m.form_to_placeholder() : shortDay(state.date, today)}
            error={errors.date === undefined ? undefined : m.form_error_date_invalid()}
          >
            <input
              id={ids.date}
              className={styles.overlay}
              type="date"
              value={state.date}
              {...labelled(ids.date, errors.date === undefined ? undefined : m.form_error_date_invalid())}
              onClick={(event) => {
                // On a computer, a click on the hidden field selects a part of the date instead of opening the calendar.
                try {
                  event.currentTarget.showPicker();
                } catch {
                  // Not allowed here (or not there): the field keeps its own behaviour.
                }
              }}
              onChange={(event) => {
                dispatch({ type: 'date', value: event.target.value });
              }}
            />
          </Case>
          {reimbursement ? null : (
            <Case id={ids.mode} label={m.form_split()} value={modeLabel(state.mode)} highlighted={state.mode === 'amounts'}>
              <select
                id={ids.mode}
                className={styles.overlay}
                value={state.mode}
                {...labelled(ids.mode, undefined)}
                onChange={(event) => {
                  dispatch({ type: 'mode', mode: event.target.value === 'amounts' ? 'amounts' : 'equal' });
                }}
              >
                {(['equal', 'amounts'] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabel(mode)}
                  </option>
                ))}
              </select>
            </Case>
          )}
        </div>
        {reimbursement ? null : (
          <Split view={view} members={members} state={state} errors={errors} shortName={shortName} dispatch={dispatch} splitId={ids.split} />
        )}
        {queueError === undefined ? null : (
          <p className={layout.error} role="alert">
            {queueErrorMessage(queueError)}
          </p>
        )}
      </form>
    </>
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

interface SplitProps {
  readonly view: GroupView;
  readonly members: readonly Member[];
  readonly state: FormState;
  readonly errors: FormErrors;
  readonly shortName: (id: MemberId) => string;
  readonly dispatch: (action: FormAction) => void;
  readonly splitId: string;
}

/** Who shares an expense: a grid of avatars to check for equal shares; with amounts, a line for each member chosen and the others to add. */
function Split({ view, members, state, errors, shortName, dispatch, splitId }: SplitProps) {
  const error = splitError(errors, state);
  const errorId = `${splitId}-error`;
  const chosen = members.filter((member) => state.checked.includes(member.id));
  const toggle = (member: MemberId) => {
    dispatch({ type: 'toggle', member });
  };
  return (
    <fieldset className={styles.split} {...(error === undefined ? {} : { 'aria-describedby': errorId, tabIndex: -1 })}>
      <legend className={layout.visuallyHidden}>{m.form_for_whom()}</legend>
      <div className={styles.splitHead}>
        <span className={styles.forWhom}>{m.form_for_whom_count({ checked: String(state.checked.length), members: String(members.length) })}</span>
        <button
          className={styles.quick}
          type="button"
          onClick={() => {
            dispatch({ type: 'checkAll', members: members.map((member) => member.id) });
          }}
        >
          {m.form_check_all()}
        </button>
        <button
          className={styles.quick}
          type="button"
          onClick={() => {
            dispatch({ type: 'uncheckAll' });
          }}
        >
          {m.form_uncheck_all()}
        </button>
        <Status state={state} />
      </div>
      {state.mode === 'equal' ? (
        <MemberGrid view={view} members={members} checked={state.checked} shortName={shortName} onToggle={toggle} />
      ) : (
        <>
          {chosen.length === 0 ? null : (
            <ul className={styles.lines}>
              {chosen.map((member) => {
                const lineError = memberAmountError(errors, member.id);
                const inputId = `${splitId}-${member.id}`;
                return (
                  <li key={member.id} className={styles.line}>
                    <Avatar member={member} view={view} />
                    <span className={styles.lineName}>{shortName(member.id)}</span>
                    <input
                      id={inputId}
                      className={`${styles.input ?? ''} ${styles.lineAmount ?? ''}`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0,00"
                      aria-label={m.form_amount_of({ name: view.nameOf(member.id) })}
                      value={state.amounts[member.id] ?? ''}
                      {...invalid(inputId, lineError)}
                      onChange={(event) => {
                        dispatch({ type: 'memberAmount', member: member.id, value: event.target.value });
                      }}
                    />
                    <button
                      className={layout.iconButton}
                      type="button"
                      aria-label={m.form_remove({ name: view.nameOf(member.id) })}
                      onClick={() => {
                        toggle(member.id);
                      }}
                    >
                      <CloseIcon />
                    </button>
                    {lineError === undefined ? null : (
                      <p id={`${inputId}-error`} className={`${layout.error ?? ''} ${styles.lineError ?? ''}`}>
                        {lineError}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {chosen.length === members.length ? null : (
            <>
              <p className={styles.addSomeone}>{m.form_add_someone()}</p>
              <MemberGrid
                view={view}
                members={members.filter((member) => !state.checked.includes(member.id))}
                checked={[]}
                shortName={shortName}
                onToggle={toggle}
              />
            </>
          )}
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

/** Next to “For whom”: each equal share, or what is left to share or over the control total. */
function Status({ state }: { readonly state: FormState }) {
  const status = splitStatus(state);
  let text = '';
  let tone: string | undefined;
  if (status?.kind === 'each') {
    text =
      status.low === status.high
        ? m.form_each({ amount: formatCents(status.low) })
        : m.form_each_range({ low: centsToInput(status.low), high: formatCents(status.high) });
  } else if (status?.kind === 'left') {
    text = m.form_left({ amount: formatCents(status.amount) });
    tone = styles.left;
  } else if (status?.kind === 'over') {
    text = m.form_over({ amount: formatCents(status.amount) });
    tone = styles.over;
  } else if (status?.kind === 'matches' && typedSum(state) > 0) {
    text = m.form_matches();
  }
  return (
    <span className={`${styles.status ?? ''} ${tone ?? ''}`} aria-live="polite">
      {text}
    </span>
  );
}

interface MemberGridProps {
  readonly view: GroupView;
  readonly members: readonly Member[];
  readonly checked: readonly MemberId[];
  readonly shortName: (id: MemberId) => string;
  readonly onToggle: (member: MemberId) => void;
}

/** Members as round avatars to touch, in the order of decision 24 whatever is checked, so that nobody moves under the finger. */
function MemberGrid({ view, members, checked, shortName, onToggle }: MemberGridProps) {
  return (
    <ul className={styles.grid}>
      {members.map((member) => {
        const pressed = checked.includes(member.id);
        return (
          <li key={member.id}>
            <button
              className={styles.cell}
              type="button"
              aria-pressed={pressed}
              aria-label={view.nameOf(member.id)}
              title={view.nameOf(member.id)}
              onClick={() => {
                onToggle(member.id);
              }}
            >
              <span className={styles.avatar}>
                <Avatar member={member} view={view} />
                {pressed ? <CheckIcon /> : null}
              </span>
              <span className={styles.cellName}>{shortName(member.id)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface MemberSelectProps {
  readonly id: string;
  readonly members: readonly Member[];
  readonly value: MemberId | undefined;
  readonly nameOf: (id: MemberId) => string;
  readonly error?: string | undefined;
  readonly onChange: (member: MemberId) => void;
}

/** The native list of members over a box: the phone's own picker, the box showing the choice. */
function MemberSelect({ id, members, value, nameOf, error, onChange }: MemberSelectProps) {
  return (
    <select
      id={id}
      className={styles.overlay}
      value={value ?? ''}
      {...labelled(id, error)}
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
          {nameOf(member.id)}
        </option>
      ))}
    </select>
  );
}

/** A field in its box, the label small above it, its error under the box. */
function Box({
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
}) {
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

/**
 * A box of fixed width showing a choice, its native control laid over it, invisible: a touch opens the phone's own picker. A long name is cut
 * in the box, whole in the control.
 */
function Case({
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
}) {
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

function FieldError({ id, error }: { readonly id: string; readonly error: string | undefined }) {
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

function CheckIcon() {
  return (
    <svg className={styles.check} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Names a control by its box's label, and ties it to its message under the box. */
function labelled(id: string, error: string | undefined) {
  return { 'aria-labelledby': `${id}-label`, ...invalid(id, error) };
}

/** Marks a field invalid and ties it to its message, rendered under the id `<id>-error`. */
function invalid(id: string, error: string | undefined) {
  return error === undefined ? {} : { 'aria-invalid': true, 'aria-describedby': `${id}-error` };
}

function modeLabel(mode: SplitMode): string {
  return mode === 'equal' ? m.form_mode_equal() : m.form_mode_amounts();
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

function memberAmountError(errors: FormErrors, member: MemberId): string | undefined {
  const error = errors.amounts?.[member];
  return error === undefined ? undefined : error === 'missing' ? m.form_error_member_missing() : m.form_error_member_amount();
}

function splitError(errors: FormErrors, state: FormState): string | undefined {
  const messages: Record<NonNullable<FormErrors['split']>, () => string> = {
    none_checked: state.kind === 'reimbursement' ? m.form_error_no_receiver : m.form_error_none_checked,
    same_member: m.form_error_same_member,
    too_large: m.form_error_too_large,
    several_receivers: m.form_reimbursement_several,
  };
  return errors.split === undefined ? undefined : messages[errors.split]();
}
