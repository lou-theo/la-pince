import { type MemberId, memberIdSchema } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { memberSheet, type Standing } from '../model/balances.ts';
import { formatCents } from '../model/money.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import layout from './Layout.module.css';
import { BackBar } from './Layout.tsx';
import { PlusIcon, TransferLine } from './Transfers.tsx';
import { type GroupView, memberOf, shortName, syncLine } from './view.ts';

/** A member's sheet, reached from the ranking: their balance, then the transfers they should make, or those they should receive. */
export function MemberBalance({ view, id: path }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const pays = useId();
  const receives = useId();
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
      <Link className={styles.declare} href={declareHref(view, id, sheet.standing)}>
        <PlusIcon />
        {m.member_declare()}
      </Link>
      {sheet.pays.length === 0 && sheet.receives.length === 0 ? <p className={layout.muted}>{m.member_nothing()}</p> : null}
      {sheet.pays.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={pays}>
          <h3 id={pays} className={styles.sheetTitle}>
            {mine ? m.member_pays_me() : m.member_pays()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {sheet.pays.map((transfer) => (
              <TransferLine
                key={transfer.to}
                view={view}
                transfer={transfer}
                avatar={transfer.to}
                text={m.transfer_to({ name: shortName(view, transfer.to, 'object') })}
              />
            ))}
          </ul>
        </section>
      )}
      {sheet.receives.length === 0 ? null : (
        <section className={styles.sheetSection} aria-labelledby={receives}>
          <h3 id={receives} className={styles.sheetTitle}>
            {mine ? m.member_receives_me() : m.member_receives()}
          </h3>
          <ul className={`${styles.card ?? ''} ${styles.transferLines ?? ''}`}>
            {sheet.receives.map((transfer) => (
              <TransferLine key={transfer.from} view={view} transfer={transfer} avatar={transfer.from} text={shortName(view, transfer.from)} />
            ))}
          </ul>
        </section>
      )}
      {sheet.pays.length === 0 && sheet.receives.length === 0 ? null : <p className={layout.muted}>{m.member_suggested()}</p>}
      <p className={layout.muted}>{syncLine(view)}</p>
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
 * The reimbursement form, with the member on the side their balance asks for: paying for one who owes or is settled, receiving for one the group
 * owes. Who I am pays by default: when the group owes me, nobody is prefilled, the form not taking a payer and a receiver who are the same member.
 */
function declareHref(view: GroupView, id: MemberId, standing: Standing): string {
  if (standing === 'ahead') {
    return id === view.me ? '/nouveau-remboursement' : `/nouveau-remboursement?${new URLSearchParams({ a: id }).toString()}`;
  }
  return `/nouveau-remboursement?${new URLSearchParams({ de: id }).toString()}`;
}
