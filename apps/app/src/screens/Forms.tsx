import { type MemberId, operationIdSchema } from '@la-pince/core';
import { type ReactNode, useState } from 'react';
import { Link, useSearch } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { localDay } from '../model/dates.ts';
import { editForm, newExpense, newReimbursement } from '../model/operationForm.ts';
import layout from './Layout.module.css';
import { ScreenBar } from './Layout.tsx';
import styles from './OperationForm.module.css';
import { CloseIcon, OperationForm } from './OperationForm.tsx';
import type { GroupView } from './view.ts';

// A new operation gets its identifier once, when its form opens: the preview's leftover cent depends on it.
const newId = () => operationIdSchema.parse(crypto.randomUUID());

export function NewExpense({ view }: { readonly view: GroupView }): ReactNode {
  const [initial] = useState(() => newExpense({ id: newId(), me: view.me, today: localDay(new Date()) }));
  return <OperationForm view={view} initial={initial} editing={false} />;
}

/** A new reimbursement; `?de=&a=&montant=` prefill it from a suggested transfer, members unknown to the group being ignored. */
export function NewReimbursement({ view }: { readonly view: GroupView }): ReactNode {
  const search = new URLSearchParams(useSearch());
  const member = (key: string) => view.members.find((candidate) => candidate.id === search.get(key))?.id;
  const amount = search.get('montant');
  const [initial] = useState(() =>
    newReimbursement({
      id: newId(),
      title: m.operation_reimbursement(),
      today: localDay(new Date()),
      from: member('de') ?? view.me,
      to: member('a'),
      amount: amount !== null && /^\d{1,11}$/.test(amount) ? Number(amount) : undefined,
    }),
  );
  return <OperationForm view={view} initial={initial} editing={false} />;
}

/** Link to a reimbursement prefilled from a suggested transfer. */
export function settleHref(from: MemberId, to: MemberId, amount: number): string {
  return `/nouveau-remboursement?${new URLSearchParams({ de: from, a: to, montant: String(amount) }).toString()}`;
}

export function EditOperation({ view, id }: { readonly view: GroupView; readonly id: string }): ReactNode {
  const operation = view.operations.find((candidate) => candidate.id === id);
  if (operation === undefined) {
    return (
      <>
        <CloseBar href="/" heading={m.form_edit_expense()} />
        <p className={layout.muted}>{m.operation_not_found()}</p>
        <Link className={layout.link} href="/">
          {m.operation_back()}
        </Link>
      </>
    );
  }
  // The form gives a reimbursement a single receiver: saving one to several would move the money of the others.
  if (operation.kind === 'reimbursement' && operation.effect.shares.length > 1) {
    return (
      <>
        <CloseBar href={`/operations/${operation.id}`} heading={m.form_edit_reimbursement()} />
        <p className={layout.muted}>{m.form_reimbursement_several()}</p>
      </>
    );
  }
  return <OperationForm view={view} initial={editForm(operation)} editing />;
}

/** The band of a form that cannot open: the way back and the title, without a button to save. */
function CloseBar({ href, heading }: { readonly href: string; readonly heading: string }) {
  return (
    <ScreenBar>
      <Link className={layout.iconButton} href={href} aria-label={m.form_close()}>
        <CloseIcon />
      </Link>
      <h1 className={`${layout.name ?? ''} ${styles.heading ?? ''}`}>{heading}</h1>
    </ScreenBar>
  );
}
