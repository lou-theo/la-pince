import { type MemberId, memberIdSchema } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { memberSheet, type Standing } from '../model/balances.ts';
import { formatCents } from '../model/money.ts';
import { transferRows } from '../model/settle.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import { reimbursementHref } from './Forms.tsx';
import layout from './Layout.module.css';
import { BackBar } from './Layout.tsx';
import { PlusIcon, rowKey, TransferLine } from './Transfers.tsx';
import { UndoBanner } from './UndoBanner.tsx';
import { useSettle } from './useSettle.ts';
import { type GroupView, isMember, memberOf, shortName, syncLine } from './view.ts';

/** A member's sheet, reached from the ranking: their balance, then the transfers they should make, or those they should receive, each with “C'est payé”. */
export function MemberBalance({ view, id: path }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const pays = useId();
  const receives = useId();
  const settle = useSettle(view);
  const parsed = memberIdSchema.safeParse(path);
  const sheet = parsed.success ? memberSheet(parsed.data, view.balances, view.transfers, view.members) : undefined;
  const bar = <BackBar href="/soldes" label={m.transfers_back()} title={m.balances_title()} />;
  if (!parsed.success || sheet === undefined) {
    return (
      <>
        {bar}
        <p className={layout.muted}>{m.member_not_found()}</p>
      </>
    );
  }
  const id = parsed.data;
  const mine = id === view.me;
  const payRows = transferRows(
    sheet.pays,
    settle.paid.filter((line) => line.transfer.from === id),
    settle.live,
  );
  const receiveRows = transferRows(
    sheet.receives,
    settle.paid.filter((line) => line.transfer.to === id),
    settle.live,
  );
  return (
    <>
      {bar}
      <div className={styles.sheetHead}>
        <span className={styles.bigAvatar}>
          <Avatar member={memberOf(view, id)} view={view} />
        </span>
        <h2 className={styles.sheetName}>{view.nameOf(id)}</h2>
        <StandingLine standing={sheet.standing} balance={sheet.balance} mine={mine} />
      </div>
      {/* A member who left the group is not offered by the reimbursement page: the server would refuse a reimbursement naming them. */}
      {isMember(view, id) ? (
        <Link className={styles.declare} href={declareHref(id, sheet.standing)}>
          <PlusIcon />
          {m.member_declare()}
        </Link>
      ) : null}
      {payRows.length === 0 && receiveRows.length === 0 ? <p className={layout.muted}>{m.member_nothing()}</p> : null}
      {payRows.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={pays}>
          <h3 id={pays} className={styles.sheetTitle}>
            {mine ? m.member_pays_me() : m.member_pays()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {payRows.map((row) => (
              <TransferLine
                key={rowKey(row)}
                view={view}
                row={row}
                settle={settle}
                avatar={row.transfer.to}
                text={m.transfer_to({ name: shortName(view, row.transfer.to, 'object') })}
              />
            ))}
          </ul>
        </section>
      )}
      {receiveRows.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={receives}>
          <h3 id={receives} className={styles.sheetTitle}>
            {mine ? m.member_receives_me() : m.member_receives()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {receiveRows.map((row) => (
              <TransferLine
                key={rowKey(row)}
                view={view}
                row={row}
                settle={settle}
                avatar={row.transfer.from}
                text={shortName(view, row.transfer.from)}
              />
            ))}
          </ul>
        </section>
      )}
      {payRows.length === 0 && receiveRows.length === 0 ? null : <p className={layout.muted}>{m.member_suggested()}</p>}
      <p className={layout.muted}>{syncLine(view)}</p>
      <UndoBanner view={view} settle={settle} />
    </>
  );
}

function StandingLine({ standing, balance, mine }: { readonly standing: Standing; readonly balance: number; readonly mine: boolean }) {
  const amount = <strong className={styles.sheetAmount}>{formatCents(Math.abs(balance))}</strong>;
  switch (standing) {
    case 'settled':
      return <p className={styles.word}>{m.member_settled()}</p>;
    case 'owes':
      return (
        <p className={styles.owes}>
          {mine ? m.member_owes_me() : m.member_owes()} {amount}
        </p>
      );
    case 'ahead':
      return (
        <p className={styles.ahead}>
          {mine ? m.member_ahead_me() : m.member_ahead()} {amount}
        </p>
      );
  }
}

/**
 * The reimbursement page, with the member on the side their balance asks for: giving for one who owes or is settled, receiving for one the group
 * owes, me included, the page then asking who gives it. Closing it comes back to this sheet.
 */
function declareHref(id: MemberId, standing: Standing): string {
  const back = `/soldes/membres/${encodeURIComponent(id)}`;
  return standing === 'ahead' ? reimbursementHref({ to: id, back }) : reimbursementHref({ from: id, back });
}
