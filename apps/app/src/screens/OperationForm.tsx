import type { Member, MemberId } from '@la-pince/core';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { localDay, shortDay } from '../model/dates.ts';
import { selectionOrder } from '../model/members.ts';
import { centsToInput, formatCents } from '../model/money.ts';
import { type FormAction, type FormErrors, type FormState, type SplitMode, splitStatus, typedSum } from '../model/operationForm.ts';
import { Avatar } from './Avatar.tsx';
import {
  amountError,
  Box,
  Case,
  CloseIcon,
  DateInput,
  FormBar,
  invalid,
  labelled,
  QueueErrorLine,
  splitError,
  useOperationForm,
} from './FormFrame.tsx';
import layout from './Layout.module.css';
import styles from './OperationForm.module.css';
import type { GroupView } from './view.ts';

interface OperationFormProps {
  readonly view: GroupView;
  readonly initial: FormState;
  /** Whether the expense is already saved: the title, the button and the way back change. */
  readonly editing: boolean;
}

/** Form of an expense, new or to modify, on the whole screen; saved, it opens the expense's detail. */
export function OperationForm({ view, initial, editing }: OperationFormProps): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);
  const frame = useOperationForm(view, initial, editing ? `/operations/${initial.id}` : '/', formRef);
  const { state, dispatch, errors } = frame;
  // The day against which the date box says “aujourd’hui” or “hier”.
  const [today] = useState(() => localDay(new Date()));
  const ids = { title: useId(), amount: useId(), date: useId(), payer: useId(), mode: useId(), split: useId() };

  const members = useMemo(() => selectionOrder(view.members, view.me, view.operations), [view.members, view.me, view.operations]);
  // Who I am is “Toi” in the narrow places of the form, a member's full name being in the labels.
  const shortName = (id: MemberId) => (id === view.me ? m.form_you() : (view.members.find((member) => member.id === id)?.name ?? id));
  const dateError = errors.date === undefined ? undefined : m.form_error_date_invalid();
  const amountsMode = state.mode === 'amounts';

  return (
    <>
      <FormBar frame={frame} heading={editing ? m.form_edit_expense() : m.form_new_expense()} action={editing ? m.form_save() : m.form_add()} />
      <form id={frame.formId} ref={formRef} className={styles.form} onSubmit={frame.save} noValidate>
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
            <span className={styles.moneyLine}>
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
              <span aria-hidden="true">€</span>
            </span>
          </Box>
        </div>
        <div className={styles.cases}>
          <Case id={ids.payer} label={m.form_payer()} value={state.payer === undefined ? m.form_choose() : shortName(state.payer)}>
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
          <Case id={ids.date} label={m.form_date()} value={state.date === '' ? m.form_choose() : shortDay(state.date, today)} error={dateError}>
            <DateInput id={ids.date} value={state.date} error={dateError} dispatch={dispatch} />
          </Case>
          <Case id={ids.mode} label={m.form_split()} value={modeLabel(state.mode)} highlighted={state.mode === 'amounts'}>
            <select
              id={ids.mode}
              className={styles.overlay}
              value={state.mode}
              aria-labelledby={`${ids.mode}-label`}
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
        </div>
        <Split view={view} members={members} state={state} errors={errors} shortName={shortName} dispatch={dispatch} splitId={ids.split} />
        <QueueErrorLine error={frame.queueError} />
      </form>
    </>
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
  } else if (status?.kind === 'matches') {
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

/** Members as round avatars to touch, in the order of docs/decisions/ordre-des-membres.md whatever is checked, so that nobody moves under the finger. */
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
          {m.form_choose()}
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

function CheckIcon() {
  return (
    <svg className={styles.check} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

function memberAmountError(errors: FormErrors, member: MemberId): string | undefined {
  const error = errors.amounts?.[member];
  return error === undefined ? undefined : error === 'missing' ? m.form_error_member_missing() : m.form_error_member_amount();
}
