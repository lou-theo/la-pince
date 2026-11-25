import type { MemberId } from '@la-pince/core';
import { type ReactNode, useState } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { transfersByDebtor } from '../model/balances.ts';
import { formatCents } from '../model/money.ts';
import { debtorCards, type TransferRow } from '../model/settle.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import { reimbursementHref } from './Forms.tsx';
import layout from './Layout.module.css';
import { BackBar } from './Layout.tsx';
import { paidText, UndoBanner } from './UndoBanner.tsx';
import { type Settle, useSettle } from './useSettle.ts';
import { type GroupView, isMember, memberOf, shortName, syncLine } from './view.ts';

/**
 * The transfers that would settle the group, grouped by who pays them, the largest debt first; my lines in bold. “C'est payé” records one at once;
 * its line stays, “Payé”, and the debtors keep the order the screen opened with while it is open.
 */
export function Transfers({ view }: { readonly view: GroupView }): ReactNode {
  const settle = useSettle(view);
  const [order] = useState(() => transfersByDebtor(view.transfers, view.members).map((debtor) => debtor.debtor));
  const cards = debtorCards(view.transfers, view.members, settle.paid, settle.live, order);
  return (
    <>
      <BackBar href="/soldes" label={m.transfers_back()} title={m.transfers_title()} />
      <Link className={styles.declare} href={reimbursementHref({ back: '/soldes/virements' })}>
        <PlusIcon />
        {m.transfers_declare_other()}
      </Link>
      {cards.length === 0 ? (
        <p className={layout.muted}>{m.transfers_none()}</p>
      ) : (
        <ul className={styles.debtors}>
          {cards.map(({ debtor, total, rows }) => (
            <li key={debtor} className={styles.card}>
              <h2
                className={styles.cardHead}
                aria-label={
                  total === 0
                    ? m.balances_line_settled({ name: view.nameOf(debtor) })
                    : m.balances_line({ name: view.nameOf(debtor), standing: m.balances_owes(), amount: formatCents(total) })
                }
              >
                <Avatar member={memberOf(view, debtor)} view={view} />
                <span className={styles.name} title={view.nameOf(debtor)}>
                  {shortName(view, debtor)}
                </span>
                {total === 0 ? (
                  <span className={styles.word}>{m.balances_settled()}</span>
                ) : (
                  <>
                    <span className={`${styles.word ?? ''} ${styles.owes ?? ''}`}>{m.balances_owes()}</span>
                    <span className={`${styles.amount ?? ''} ${styles.owes ?? ''}`}>{formatCents(total)}</span>
                  </>
                )}
              </h2>
              <ul className={styles.transferLines}>
                {rows.map((row) => (
                  <TransferLine
                    key={rowKey(row)}
                    view={view}
                    row={row}
                    settle={settle}
                    text={m.transfer_to({ name: shortName(view, row.transfer.to, 'object') })}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className={layout.muted}>{syncLine(view)}</p>
      <UndoBanner view={view} settle={settle} nav />
    </>
  );
}

/** A due transfer is one per pair of members; a paid one is its reimbursement, the same pair possibly paid twice on the screen. */
export function rowKey(row: TransferRow): string {
  return row.kind === 'paid' ? row.operation.id : `${row.transfer.from}>${row.transfer.to}`;
}

/**
 * A suggested transfer, in bold when it is mine, and “C'est payé” to record it; or, struck, one paid on this screen. `avatar` shows who is on the
 * other side. A member who left the group gets no button: the server would refuse a reimbursement naming them.
 */
export function TransferLine({
  view,
  row,
  settle,
  text,
  avatar,
}: {
  readonly view: GroupView;
  readonly row: TransferRow;
  readonly settle: Settle;
  readonly text: string;
  readonly avatar?: MemberId;
}): ReactNode {
  const { transfer } = row;
  const mine = transfer.from === view.me || transfer.to === view.me;
  const classes = [styles.transferLine, mine ? styles.mineText : undefined, row.kind === 'paid' ? styles.paid : undefined]
    .filter((name) => name !== undefined)
    .join(' ');
  const other = avatar === undefined ? null : <Avatar member={memberOf(view, avatar)} view={view} />;
  if (row.kind === 'paid') {
    return (
      <li className={classes} aria-label={m.transfer_paid_line({ line: paidText(view, row) })}>
        {other}
        <s className={styles.name}>{text}</s>
        <s className={styles.transferAmount}>{formatCents(transfer.amount)}</s>
        <span className={styles.paidMark}>
          <CheckIcon />
          {m.transfer_paid()}
        </span>
      </li>
    );
  }
  const line = m.transfer_line({ from: view.nameOf(transfer.from), amount: formatCents(transfer.amount), to: view.nameOf(transfer.to) });
  return (
    <li className={classes}>
      {other}
      <span className={styles.name} title={line}>
        {text}
      </span>
      <span className={styles.transferAmount}>{formatCents(transfer.amount)}</span>
      {isMember(view, transfer.from) && isMember(view, transfer.to) ? (
        <button
          className={styles.settle}
          type="button"
          aria-label={m.transfer_pay_label({ line })}
          disabled={settle.busy !== undefined}
          onClick={() => {
            settle.pay(transfer);
          }}
        >
          {m.transfer_pay()}
        </button>
      ) : null}
    </li>
  );
}

function CheckIcon() {
  return (
    <svg
      className={styles.check}
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
  );
}

export function PlusIcon(): ReactNode {
  return (
    <svg className={styles.plus} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
