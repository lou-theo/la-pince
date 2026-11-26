import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { dayHeading, localDay } from '../model/dates.ts';
import type { OperationView } from '../model/group.ts';
import { filterOperations, isActive, type ListFilter, type ResultHeading, resultHeading } from '../model/listFilter.ts';
import { byDay, type MyPart, myPart } from '../model/listing.ts';
import { formatCents } from '../model/money.ts';
import { Avatar } from './Avatar.tsx';
import layout from './Layout.module.css';
import filters from './ListFilters.module.css';
import styles from './OperationList.module.css';
import { type GroupView, memberOf, sharesInOrder, who } from './view.ts';

/**
 * The group's operations the filters keep, the latest day first, one card each saying in words what it means for me, and the button to add an
 * expense; a filtered list says above it what it counts.
 */
export function OperationList({ view, filter }: { readonly view: GroupView; readonly filter: ListFilter }): ReactNode {
  // Read once: the heading only drops the year of the current year.
  const [today] = useState(() => localDay(new Date()));
  const active = isActive(filter, view.me);
  const shown = useMemo(
    () => (active ? filterOperations(view.operations, filter, view.me) : view.operations),
    [active, view.operations, filter, view.me],
  );
  return (
    <>
      {active && shown.length > 0 ? <p className={filters.heading}>{headingText(resultHeading(shown, view.me))}</p> : null}
      {shown.length === 0 ? (
        <p className={layout.muted}>{active ? m.filters_empty() : m.operations_empty()}</p>
      ) : (
        <div className={styles.days}>
          {byDay(shown).map(({ day, operations }) => (
            <section key={day} className={styles.day}>
              <h2 className={styles.dayHeading}>{dayHeading(day, today)}</h2>
              <ul className={styles.list}>
                {operations.map((operation) => (
                  <li key={operation.id}>
                    <Line view={view} operation={operation} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Link className={styles.add} href="/nouvelle-depense" aria-label={m.operations_add_expense()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </>
  );
}

function Line({ view, operation }: { readonly view: GroupView; readonly operation: OperationView }) {
  const part = myPart(operation, view.me);
  return (
    <Link className={styles.row} href={`/operations/${operation.id}`}>
      <span className={styles.main}>
        <span className={styles.title}>{operation.title}</span>
        <span className={styles.sub}>
          <span className={styles.payer}>
            <Avatar member={memberOf(view, operation.effect.payer)} view={view} />
          </span>
          <span>{subLine(view, operation, part)}</span>
        </span>
        {operation.pending ? <span className={styles.pending}>{m.operation_pending()}</span> : null}
      </span>
      <span className={`${styles.part ?? ''} ${styles[part.kind] ?? ''}`}>
        <span className={styles.partLabel}>{partLabel(part)}</span>
        {part.kind === 'not_involved' ? null : <span className={styles.amount}>{formatCents(part.amount)}</span>}
      </span>
    </Link>
  );
}

/** Who paid and how much, or who reimbursed whom, “you” standing for who I am; the amount of an operation that leaves me out comes here. */
function subLine(view: GroupView, operation: OperationView, part: MyPart): string {
  const { payer, total } = operation.effect;
  const amount = formatCents(total);
  if (operation.kind === 'expense') {
    return payer === view.me ? m.operation_you_paid({ amount }) : m.operation_paid({ name: view.nameOf(payer), amount });
  }
  const to = sharesInOrder(view, operation).map((share) => view.nameOf(share.member));
  if (part.kind === 'sent') {
    return m.operation_you_reimbursed({ to: to.join(', ') });
  }
  if (part.kind === 'received') {
    // To me alone it reads as “paid you back”; to several members, each is named.
    return to.length === 1 ? m.operation_reimbursed_you({ from: view.nameOf(payer) }) : who(view, operation);
  }
  return m.operation_reimbursed_amount({ from: view.nameOf(payer), amount, to: to.join(', ') });
}

function headingText(heading: ResultHeading): string {
  const total = formatCents(heading.total);
  if (heading.kind === 'reimbursement') {
    return heading.count === 1
      ? m.filters_heading_reimbursements_one({ total })
      : m.filters_heading_reimbursements({ count: String(heading.count), total });
  }
  const share = formatCents(heading.myShare);
  return heading.count === 1 ? m.filters_heading_one({ total, share }) : m.filters_heading({ count: String(heading.count), total, share });
}

function partLabel(part: MyPart): string {
  switch (part.kind) {
    case 'owe':
      return m.part_owe();
    case 'advanced':
      return m.part_advanced();
    case 'own':
      return m.part_own();
    case 'received':
      return m.part_received();
    case 'sent':
      return m.part_sent();
    case 'not_involved':
      return m.operation_not_involved();
  }
}
