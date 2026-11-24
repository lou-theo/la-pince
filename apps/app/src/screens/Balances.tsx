import type { MemberId } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { decorScale, decorSize, standing } from '../model/balances.ts';
import type { BalanceLine } from '../model/group.ts';
import { formatCents } from '../model/money.ts';
import { Avatar } from './Avatar.tsx';
import styles from './Balances.module.css';
import { Bag, Ball } from './Decor.tsx';
import layout from './Layout.module.css';
import { type GroupView, shortName, syncLine } from './view.ts';

/**
 * The ranking of the balances, the group owing the most to the first and the last owing the group the most, who I am at my place; each line opens
 * the member's sheet, and a link below opens the transfers that would settle the group.
 */
export function Balances({ view }: { readonly view: GroupView }): ReactNode {
  const title = useId();
  const scale = decorScale(view.balances);
  const count = view.transfers.length;
  const countText = count === 1 ? m.balances_transfers_one() : m.balances_transfers({ count: String(count) });
  return (
    <>
      <section className={styles.card} aria-labelledby={title}>
        <h2 id={title} className={layout.visuallyHidden}>
          {m.balances_title()}
        </h2>
        {/* A banner only above or below someone it names. */}
        {view.balances.some((line) => line.balance > 0) ? (
          <div className={`${styles.banner ?? ''} ${styles.aheadBanner ?? ''}`} aria-hidden="true">
            <Bag size={16} />
            {m.balances_ahead_banner()}
          </div>
        ) : null}
        <ul className={styles.ranking}>
          {view.balances.map((line) => (
            <RankingLine key={line.member.id} view={view} line={line} scale={scale} />
          ))}
        </ul>
        {view.balances.some((line) => line.balance < 0) ? (
          <div className={`${styles.banner ?? ''} ${styles.owesBanner ?? ''}`} aria-hidden="true">
            <Ball size={16} />
            {m.balances_owes_banner()}
          </div>
        ) : null}
      </section>
      {count === 0 ? (
        <p className={styles.settleAll}>{m.balances_all_settled()}</p>
      ) : (
        // Named in full: a screen reader would join the two spans into one word.
        <Link className={styles.settleAll} href="/soldes/virements" aria-label={`${m.balances_settle_all()} · ${countText}`}>
          <span className={styles.settleAllTitle}>{m.balances_settle_all()}</span>
          <span className={styles.settleAllCount}>{countText}</span>
          <Chevron />
        </Link>
      )}
      <p className={layout.muted}>{syncLine(view)}</p>
    </>
  );
}

function RankingLine({ view, line, scale }: { readonly view: GroupView; readonly line: BalanceLine; readonly scale: number }) {
  const { member, balance } = line;
  const where = standing(balance);
  const mine = member.id === view.me;
  const word = where === 'ahead' ? m.balances_ahead() : where === 'owes' ? m.balances_owes() : m.balances_settled();
  const amount = formatCents(Math.abs(balance));
  const label =
    where === 'settled'
      ? m.balances_line_settled({ name: view.nameOf(member.id) })
      : m.balances_line({ name: view.nameOf(member.id), standing: word, amount });
  return (
    <li>
      <Link className={mine ? `${styles.line ?? ''} ${styles.mine ?? ''}` : styles.line} href={memberHref(member.id)} aria-label={label}>
        <span className={styles.avatar}>
          <Avatar member={member} view={view} />
          {where === 'ahead' ? <Bag className={styles.decor} size={decorSize(balance, scale)} /> : null}
          {where === 'owes' ? <Ball className={styles.decor} size={decorSize(balance, scale)} /> : null}
        </span>
        {/* Cut by an ellipsis when too long, whole in the tooltip and the link's name. */}
        <span className={styles.name} title={view.nameOf(member.id)}>
          {shortName(view, member.id)}
        </span>
        <span className={where === 'settled' ? styles.word : `${styles.word ?? ''} ${styles[where] ?? ''}`}>{word}</span>
        {where === 'settled' ? null : <span className={`${styles.amount ?? ''} ${styles[where] ?? ''}`}>{amount}</span>}
      </Link>
    </li>
  );
}

/** Link to a member's sheet; an identifier needs no escaping (`memberIdSchema`). */
function memberHref(member: MemberId): string {
  return `/soldes/membres/${member}`;
}

/** The arrow that says a line leads further. */
function Chevron(): ReactNode {
  return (
    <svg
      className={styles.chevron}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
