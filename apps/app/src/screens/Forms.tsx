import { type MemberId, operationIdSchema } from '@la-pince/core';
import { type ReactNode, useState } from 'react';
import { Link, useSearch } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { localDay } from '../model/dates.ts';
import { editForm, newExpense, newReimbursement } from '../model/operationForm.ts';
import { CloseIcon } from './FormFrame.tsx';
import layout from './Layout.module.css';
import { ScreenBar } from './Layout.tsx';
import styles from './OperationForm.module.css';
import { OperationForm } from './OperationForm.tsx';
import { ReimbursementForm } from './ReimbursementForm.tsx';
import type { GroupView } from './view.ts';

// A new operation gets its identifier once, when its form opens: the preview's leftover cent depends on it.
const newId = () => operationIdSchema.parse(crypto.randomUUID());

export function NewExpense({ view }: { readonly view: GroupView }): ReactNode {
  const [initial] = useState(() => newExpense({ id: newId(), me: view.me, today: localDay(new Date()) }));
  return <OperationForm view={view} initial={initial} editing={false} />;
}

// The screens a reimbursement page opens from, where closing it comes back: the balances, the transfers, or a member's sheet.
const BACK = /^\/soldes(?:\/virements|\/membres\/[^/?#]+)?$/;

/**
 * A new reimbursement, given by who I am unless `?de=` or `?a=` names a member of the group: `?a=` alone leaves who gives it to choose. `?retour=` is
 * where closing it leads, the balances when it is not one of their screens.
 */
export function NewReimbursement({ view }: { readonly view: GroupView }): ReactNode {
  const search = new URLSearchParams(useSearch());
  const member = (key: string) => view.members.find((candidate) => candidate.id === search.get(key))?.id;
  const back = search.get('retour') ?? '';
  const [initial] = useState(() => {
    const to = member('a');
    return newReimbursement({
      id: newId(),
      title: m.operation_reimbursement(),
      today: localDay(new Date()),
      from: member('de') ?? (to === undefined ? view.me : undefined),
      to,
      amount: undefined,
    });
  });
  return <ReimbursementForm view={view} initial={initial} back={BACK.test(back) ? back : '/soldes'} />;
}

/** Link to the page of a new reimbursement, given by `from` or received by `to`, closing back to `back`. */
export function reimbursementHref({ from, to, back }: { from?: MemberId; to?: MemberId; back: string }): string {
  const search = new URLSearchParams();
  if (from !== undefined) {
    search.set('de', from);
  }
  if (to !== undefined) {
    search.set('a', to);
  }
  search.set('retour', back);
  return `/nouveau-remboursement?${search.toString()}`;
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
  if (operation.kind === 'reimbursement') {
    // The page gives a reimbursement a single receiver: saving one to several would move the money of the others.
    if (operation.effect.shares.length > 1) {
      return (
        <>
          <CloseBar href={`/operations/${operation.id}`} heading={m.operation_reimbursement()} />
          <p className={layout.muted}>{m.form_reimbursement_several()}</p>
        </>
      );
    }
    return <ReimbursementForm view={view} initial={editForm(operation)} back={`/operations/${operation.id}`} />;
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
