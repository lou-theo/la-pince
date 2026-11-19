import type { MemberId } from '@la-pince/core';
import { type ReactNode, useId } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { formatDay } from '../model/dates.ts';
import { formatCents } from '../model/money.ts';
import layout from './Layout.module.css';
import styles from './Operations.module.css';
import { type GroupView, who } from './view.ts';

/** One operation: its amount, who paid, and the share of each member involved, in the order members were added. */
export function OperationDetail({ view, id }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const splitTitle = useId();
  const operation = view.operations.find((candidate) => candidate.id === id);
  const back = (
    <Link className={layout.link} href="/">
      {m.operation_back()}
    </Link>
  );
  if (operation === undefined) {
    return (
      <>
        <p className={layout.muted}>{m.operation_not_found()}</p>
        {back}
      </>
    );
  }
  const position = (member: MemberId) => {
    const index = view.memberOrder.indexOf(member);
    // A member missing from the group's list comes last.
    return index === -1 ? view.memberOrder.length : index;
  };
  const shares = operation.effect.shares.toSorted((a, b) => position(a.member) - position(b.member));
  return (
    <article className={styles.detail}>
      {back}
      <header className={styles.detailHeader}>
        <p className={layout.muted}>{operation.kind === 'reimbursement' ? m.operation_reimbursement() : formatDay(operation.date, { long: true })}</p>
        <h2 className={layout.title}>{operation.title}</h2>
        <p className={styles.bigAmount} aria-label={m.operation_total()}>
          {formatCents(operation.effect.total)}
        </p>
        <p>{who(view, operation)}</p>
        {operation.kind === 'reimbursement' ? <p className={layout.muted}>{formatDay(operation.date, { long: true })}</p> : null}
        {operation.author === undefined ? null : <p className={layout.muted}>{m.operation_entered_by({ name: view.nameOf(operation.author) })}</p>}
      </header>
      {operation.kind === 'expense' ? (
        <section className={styles.detailSection} aria-labelledby={splitTitle}>
          <h3 id={splitTitle} className={styles.sectionTitle}>
            {m.operation_split()}
          </h3>
          <ul className={styles.lines}>
            {shares.map((share) => (
              <li key={share.member} className={share.member === view.me ? styles.mine : undefined}>
                <span>{view.nameOf(share.member)}</span>
                <span>{formatCents(share.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
