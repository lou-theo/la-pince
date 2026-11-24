import type { Member, MemberId } from '@la-pince/core';
import { type ReactNode, useId, useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { standing } from '../model/balances.ts';
import { localDay, shortDay } from '../model/dates.ts';
import { formatCents } from '../model/money.ts';
import type { FormErrors, FormState } from '../model/operationForm.ts';
import { balanceContext, candidates } from '../model/settle.ts';
import { Avatar } from './Avatar.tsx';
import { amountError, Box, Case, DateInput, FormBar, invalid, labelled, QueueErrorLine, splitError, useOperationForm } from './FormFrame.tsx';
import layout from './Layout.module.css';
import formStyles from './OperationForm.module.css';
import styles from './ReimbursementForm.module.css';
import { type GroupView, memberOf, shortName } from './view.ts';

type Side = 'from' | 'to';

interface ReimbursementFormProps {
  readonly view: GroupView;
  readonly initial: FormState;
  /** Where closing the page leads: the screen it opened from. */
  readonly back: string;
}

/**
 * The page of a reimbursement, new or to modify: who gives it and who receives it, each changed by touching its box, which opens the grid of the
 * members below; the amount and the day. Its title is not shown: “Remboursement” for a new one, kept as it was for one modified.
 */
export function ReimbursementForm({ view, initial, back }: ReimbursementFormProps): ReactNode {
  const formRef = useRef<HTMLFormElement>(null);
  const frame = useOperationForm(view, initial, back, formRef);
  const { state, dispatch, errors } = frame;
  const receiver = state.checked[0];
  // The empty side first; none once both are filled, the grid then hidden until a box is touched.
  const [active, setActive] = useState<Side | undefined>(() =>
    initial.payer === undefined ? 'from' : initial.checked[0] === undefined ? 'to' : undefined,
  );
  const [today] = useState(() => localDay(new Date()));
  const ids = { amount: useId(), date: useId(), sides: useId() };

  const pick = (side: Side, member: MemberId) => {
    dispatch(side === 'from' ? { type: 'payer', member } : { type: 'receiver', member });
    const otherEmpty = side === 'from' ? receiver === undefined : state.payer === undefined;
    setActive(otherEmpty ? (side === 'from' ? 'to' : 'from') : undefined);
  };
  const sideError = sidesError(errors, state);
  const dateError = errors.date === undefined ? undefined : m.form_error_date_invalid();
  const context = balanceContext(state.payer, receiver, view.balances);

  return (
    <>
      <FormBar frame={frame} heading={m.operation_reimbursement()} action={m.form_save()} />
      <form id={frame.formId} ref={formRef} className={formStyles.form} onSubmit={frame.save} noValidate>
        <div className={styles.sides} data-invalid={sideError !== undefined}>
          <SideBox
            view={view}
            label={m.form_from()}
            member={state.payer}
            active={active === 'from'}
            error={errors.payer === undefined ? undefined : sideError}
            errorId={ids.sides}
            onTouch={() => {
              setActive('from');
            }}
          />
          <svg
            className={styles.arrow}
            viewBox="0 0 40 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 12h34M28 4l8 8-8 8" />
          </svg>
          <SideBox
            view={view}
            label={m.form_to()}
            member={receiver}
            active={active === 'to'}
            error={errors.payer === undefined && errors.split !== undefined ? sideError : undefined}
            errorId={ids.sides}
            onTouch={() => {
              setActive('to');
            }}
          />
        </div>
        {sideError === undefined ? null : (
          <p id={`${ids.sides}-error`} className={`${layout.error ?? ''} ${formStyles.fieldError ?? ''}`}>
            {sideError}
          </p>
        )}
        <div className={styles.row}>
          <Box id={ids.amount} label={m.form_amount()} error={amountError(errors, state)}>
            <span className={formStyles.moneyLine}>
              <input
                id={ids.amount}
                className={`${formStyles.input ?? ''} ${styles.amount ?? ''}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={state.amount}
                {...labelled(ids.amount, amountError(errors, state))}
                onChange={(event) => {
                  dispatch({ type: 'amount', value: event.target.value });
                }}
              />
              <span aria-hidden="true">€</span>
            </span>
          </Box>
          <Case id={ids.date} label={m.form_date()} value={state.date === '' ? m.form_choose() : shortDay(state.date, today)} error={dateError}>
            <DateInput id={ids.date} value={state.date} error={dateError} dispatch={dispatch} />
          </Case>
        </div>
        {context === undefined ? null : <p className={styles.context}>{contextText(view, context.member.id, context.balance)}</p>}
        {active === undefined ? null : (
          <section className={styles.pick} aria-labelledby={`${ids.sides}-grid`}>
            <h2 id={`${ids.sides}-grid`} className={styles.gridTitle}>
              {active === 'from' ? m.reimbursement_from_whom() : m.reimbursement_to_whom()}
            </h2>
            <MemberGrid
              view={view}
              members={candidates(view.balances, view.members, active === 'from' ? receiver : state.payer)}
              chosen={active === 'from' ? state.payer : receiver}
              onPick={(member) => {
                pick(active, member);
              }}
            />
          </section>
        )}
        <QueueErrorLine error={frame.queueError} />
      </form>
    </>
  );
}

interface SideBoxProps {
  readonly view: GroupView;
  readonly label: string;
  readonly member: MemberId | undefined;
  readonly active: boolean;
  /** The message under both sides, when it is about this one. */
  readonly error: string | undefined;
  readonly errorId: string;
  readonly onTouch: () => void;
}

/** One side of the reimbursement: the member and “changer”, or “à choisir”; pressed while the grid below chooses it. */
function SideBox({ view, label, member, active, error, errorId, onTouch }: SideBoxProps) {
  const name = member === undefined ? m.reimbursement_to_choose() : shortName(view, member);
  return (
    <button
      className={styles.side}
      type="button"
      aria-pressed={active}
      aria-label={m.reimbursement_side({ side: label, name: member === undefined ? name : view.nameOf(member) })}
      {...invalid(errorId, error)}
      onClick={onTouch}
    >
      <span className={styles.sideLabel}>{label}</span>
      {member === undefined ? (
        <span className={styles.empty} aria-hidden="true">
          ?
        </span>
      ) : (
        <Avatar member={memberOf(view, member)} view={view} />
      )}
      <span className={member === undefined ? `${styles.sideName ?? ''} ${styles.toChoose ?? ''}` : styles.sideName}>{name}</span>
      <span className={styles.hint}>{member === undefined || active ? ' ' : m.reimbursement_change()}</span>
    </button>
  );
}

/** The members to choose from, as round avatars; the one of the side being chosen is marked. */
function MemberGrid({
  view,
  members,
  chosen,
  onPick,
}: {
  readonly view: GroupView;
  readonly members: readonly Member[];
  readonly chosen: MemberId | undefined;
  readonly onPick: (member: MemberId) => void;
}) {
  return (
    <ul className={styles.grid}>
      {members.map((member) => (
        <li key={member.id}>
          <button
            className={styles.cell}
            type="button"
            aria-pressed={member.id === chosen}
            aria-label={view.nameOf(member.id)}
            title={view.nameOf(member.id)}
            onClick={() => {
              onPick(member.id);
            }}
          >
            <Avatar member={member} view={view} />
            <span className={styles.cellName}>{shortName(view, member.id)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Where the member stands, said under the fields: what they owe the group, or what it owes them. */
function contextText(view: GroupView, member: MemberId, balance: number): string {
  const mine = member === view.me;
  const name = memberOf(view, member).name;
  const amount = formatCents(Math.abs(balance));
  switch (standing(balance)) {
    case 'owes':
      return mine ? m.reimbursement_owes_me({ amount }) : m.reimbursement_owes({ name, amount });
    case 'ahead':
      return mine ? m.reimbursement_ahead_me({ amount }) : m.reimbursement_ahead({ name, amount });
    case 'settled':
      return mine ? m.reimbursement_settled_me() : m.reimbursement_settled({ name });
  }
}

/** Who is missing on either side, or the same member on both. */
function sidesError(errors: FormErrors, state: FormState): string | undefined {
  return errors.payer === undefined ? splitError(errors, state) : m.form_error_no_payer();
}
