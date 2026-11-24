import type { MemberId, SuggestedTransfer } from '@la-pince/core';
import type { ReactNode } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { transfersByDebtor } from '../model/balances.ts';
import { formatCents } from '../model/money.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import { settleHref } from './Forms.tsx';
import layout from './Layout.module.css';
import { BackBar } from './Layout.tsx';
import { type GroupView, memberOf, shortName, syncLine } from './view.ts';

/** The transfers that would settle the group, grouped by who pays them, the largest debt first; my lines in bold. */
export function Transfers({ view }: { readonly view: GroupView }): ReactNode {
  const debtors = transfersByDebtor(view.transfers, view.members);
  return (
    <>
      <BackBar href="/soldes" label={m.transfers_back()} title={m.transfers_title()} />
      <Link className={styles.declare} href="/nouveau-remboursement">
        <PlusIcon />
        {m.transfers_declare_other()}
      </Link>
      {debtors.length === 0 ? (
        <p className={layout.muted}>{m.transfers_none()}</p>
      ) : (
        <ul className={styles.debtors}>
          {debtors.map(({ debtor, total, transfers }) => (
            <li key={debtor} className={styles.card}>
              <h2 className={styles.cardHead}>
                <Avatar member={memberOf(view, debtor)} view={view} />
                <span className={styles.name} title={view.nameOf(debtor)}>
                  {shortName(view, debtor)}
                </span>
                <span className={`${styles.word ?? ''} ${styles.owes ?? ''}`}>{m.balances_owes()}</span>
                <span className={`${styles.amount ?? ''} ${styles.owes ?? ''}`}>{formatCents(total)}</span>
              </h2>
              <ul className={styles.transferLines}>
                {transfers.map((transfer) => (
                  <TransferLine
                    key={transfer.to}
                    view={view}
                    transfer={transfer}
                    text={m.transfer_to({ name: shortName(view, transfer.to, 'object') })}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className={layout.muted}>{syncLine(view)}</p>
    </>
  );
}

/** A suggested transfer and its button to record it, in bold when it is mine; `avatar` shows who is on the other side. */
export function TransferLine({
  view,
  transfer,
  text,
  avatar,
}: {
  readonly view: GroupView;
  readonly transfer: SuggestedTransfer;
  readonly text: string;
  readonly avatar?: MemberId;
}): ReactNode {
  const line = m.transfer_line({ from: view.nameOf(transfer.from), amount: formatCents(transfer.amount), to: view.nameOf(transfer.to) });
  const mine = transfer.from === view.me || transfer.to === view.me;
  return (
    <li className={mine ? `${styles.transferLine ?? ''} ${styles.mineText ?? ''}` : styles.transferLine}>
      {avatar === undefined ? null : <Avatar member={memberOf(view, avatar)} view={view} />}
      <span className={styles.name} title={line}>
        {text}
      </span>
      <span className={styles.transferAmount}>{formatCents(transfer.amount)}</span>
      {/* Opens the reimbursement prefilled with this transfer. */}
      <Link className={styles.settle} href={settleHref(transfer.from, transfer.to, transfer.amount)} aria-label={`${m.transfer_settle()} : ${line}`}>
        {m.transfer_settle_short()}
      </Link>
    </li>
  );
}

export function PlusIcon(): ReactNode {
  return (
    <svg className={styles.plus} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
