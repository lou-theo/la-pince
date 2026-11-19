import type { ReactNode } from 'react';
import { Link } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { formatDay } from '../model/dates.ts';
import { myShare, type OperationView } from '../model/group.ts';
import { formatCents } from '../model/money.ts';
import layout from './Layout.module.css';
import styles from './Operations.module.css';
import { type GroupView, who } from './view.ts';

/** The group's operations, the latest first, each with what it puts on me. */
export function OperationList({ view }: { readonly view: GroupView }): ReactNode {
  const actions = (
    <div className={layout.actions}>
      <Link className={layout.button} href="/nouvelle-depense">
        {m.operations_add_expense()}
      </Link>
      <Link className={layout.link} href="/nouveau-remboursement">
        {m.operations_add_reimbursement()}
      </Link>
    </div>
  );
  if (view.operations.length === 0) {
    return (
      <>
        {actions}
        <p className={layout.muted}>{m.operations_empty()}</p>
      </>
    );
  }
  return (
    <>
      {actions}
      <ul className={styles.list}>
        {view.operations.map((operation) => (
          <li key={operation.id}>
            <Link className={styles.row} href={`/operations/${operation.id}`}>
              <span className={styles.main}>
                <span className={styles.title}>{operation.title}</span>
                <span className={styles.meta}>
                  {formatDay(operation.date)} · {who(view, operation)}
                </span>
              </span>
              <span className={styles.amounts}>
                <span className={styles.total}>{formatCents(operation.effect.total)}</span>
                <MyShare view={view} operation={operation} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function MyShare({ view, operation }: { readonly view: GroupView; readonly operation: OperationView }) {
  if (operation.kind === 'reimbursement') {
    return <span className={styles.meta}>{m.operation_reimbursement()}</span>;
  }
  const share = myShare(operation.effect, view.me);
  if (share !== 0) {
    return <span className={styles.share}>{m.operation_my_share({ amount: formatCents(share) })}</span>;
  }
  // Paying for others without a share is not “not involved”: the money was advanced.
  return operation.effect.payer === view.me ? (
    <span className={styles.share}>{m.operation_you_advanced({ amount: formatCents(operation.effect.total) })}</span>
  ) : (
    <span className={styles.meta}>{m.operation_not_involved()}</span>
  );
}
