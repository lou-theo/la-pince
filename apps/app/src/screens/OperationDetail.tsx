import { revisionIdSchema } from '@la-pince/core';
import { type ReactNode, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';

import { sendErrorMessage } from '../i18n/errors.ts';
import { m } from '../i18n/paraglide/messages.js';
import { formatDay } from '../model/dates.ts';
import type { OperationView } from '../model/group.ts';
import { formatCents } from '../model/money.ts';
import { deletionOf } from '../model/operationForm.ts';
import type { SendError } from '../sync/groupStore.ts';
import layout from './Layout.module.css';
import styles from './Operations.module.css';
import { useMounted } from './useMounted.ts';
import { type GroupView, sharesInOrder, who } from './view.ts';

/** One operation: its amount, who paid, and the share of each member involved, in the order members were added. */
export function OperationDetail({ view, id }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const splitTitle = useId();
  const [, navigate] = useLocation();
  // The detail outlives its deletion button, which goes as soon as the deletion is read back: it leads back to the list, unless the person left.
  const mounted = useMounted();
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
  const shares = sharesInOrder(view, operation);
  return (
    <article className={styles.detail}>
      {back}
      <header className={styles.detailHeader}>
        <p className={layout.muted}>{operation.kind === 'reimbursement' ? m.operation_reimbursement() : formatDay(operation.date, { long: true })}</p>
        <h2 className={layout.title}>{operation.title}</h2>
        <p className={styles.bigAmount}>
          <span className={layout.visuallyHidden}>{m.operation_total()} </span>
          {formatCents(operation.effect.total)}
        </p>
        <p>{who(view, operation)}</p>
        {operation.kind === 'reimbursement' ? <p className={layout.muted}>{formatDay(operation.date, { long: true })}</p> : null}
        {operation.author === undefined ? null : <p className={layout.muted}>{m.operation_entered_by({ name: view.nameOf(operation.author) })}</p>}
      </header>
      {/* A reimbursement to a single member says it all in its title line. */}
      {operation.kind === 'expense' || shares.length > 1 ? (
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
      <div className={layout.actions}>
        <Link className={layout.button} href={`/operations/${operation.id}/modifier`}>
          {m.operation_edit()}
        </Link>
        <Delete
          view={view}
          operation={operation}
          onDeleted={() => {
            if (mounted.current) {
              navigate('/', { replace: true });
            }
          }}
        />
      </div>
    </article>
  );
}

/** Deletion asks once more, since it reaches every phone of the group. */
function Delete({ view, operation, onDeleted }: { readonly view: GroupView; readonly operation: OperationView; readonly onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError>();
  const [notReread, setNotReread] = useState(false);
  if (notReread) {
    return (
      <p className={layout.error} role="alert">
        {m.operation_deleted_not_read()}
      </p>
    );
  }
  if (!asking) {
    return (
      <button
        className={layout.link}
        type="button"
        onClick={() => {
          setAsking(true);
        }}
      >
        {m.operation_delete()}
      </button>
    );
  }
  const confirm = async () => {
    setSending(true);
    setError(undefined);
    const result = await view.send(deletionOf(operation, { revisionId: revisionIdSchema.parse(crypto.randomUUID()), author: view.me }));
    setSending(false);
    if (!result.ok) {
      setError(result.error);
    } else if (result.reread) {
      onDeleted();
    } else {
      setNotReread(true);
    }
  };
  return (
    <div className={styles.confirm}>
      <p>{m.operation_delete_confirm({ title: operation.title })}</p>
      <div className={layout.actions}>
        <button className={`${layout.button ?? ''} ${styles.danger ?? ''}`} type="button" disabled={sending} onClick={() => void confirm()}>
          {sending ? m.operation_deleting() : m.operation_delete_yes()}
        </button>
        {sending ? null : (
          <button
            className={layout.link}
            type="button"
            onClick={() => {
              setAsking(false);
            }}
          >
            {m.operation_delete_no()}
          </button>
        )}
      </div>
      {error === undefined ? null : (
        <p className={layout.error} role="alert">
          {sendErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
