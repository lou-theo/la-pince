import { MAX_CENTS, type OperationId, operationIdSchema, revisionIdSchema, type SuggestedTransfer } from '@la-pince/core';
import { useRef, useState } from 'react';

import { m } from '../i18n/paraglide/messages.js';
import { localDay } from '../model/dates.ts';
import { deletionOf } from '../model/operationForm.ts';
import { type PaidTransfer, settlementOf } from '../model/settle.ts';
import type { QueueError } from '../sync/groupStore.ts';
import { useMounted } from './useMounted.ts';
import type { GroupView } from './view.ts';

/** Why the phone did not take a payment: its outbox refused it, or the amount is beyond what an operation holds. */
export type SettleError = QueueError | 'too_large';

/**
 * What the band above the menu says: the last transfer paid, with a way to undo it (and why the last try to undo it failed, “Annuler” staying), or
 * why the phone did not take a payment.
 */
export type UndoState =
  { readonly kind: 'saved'; readonly paid: PaidTransfer; readonly error?: QueueError } | { readonly kind: 'failed'; readonly error: SettleError };

/** “C'est payé” on the screens of the transfers: what was paid here, the band to undo it, and a guard against a second touch while the phone saves. */
export interface Settle {
  readonly paid: readonly PaidTransfer[];
  /** Operations shown as paid: the live ones, and the one being queued, so that its line does not blink before the outbox shows it. */
  readonly live: ReadonlySet<OperationId>;
  /** What the phone is saving, during which no other payment nor undoing starts. */
  readonly busy: 'pay' | 'undo' | undefined;
  readonly band: UndoState | undefined;
  readonly pay: (transfer: SuggestedTransfer) => void;
  readonly undo: (paid: PaidTransfer) => void;
}

const newRevisionId = () => revisionIdSchema.parse(crypto.randomUUID());

/** The state of “C'est payé”, living with its screen: leaving it forgets the band, the reimbursement staying in the list. */
export function useSettle(view: GroupView): Settle {
  const [paid, setPaid] = useState<readonly PaidTransfer[]>([]);
  const [queuing, setQueuing] = useState<OperationId>();
  const [busy, setBusy] = useState<'pay' | 'undo'>();
  const [band, setBand] = useState<UndoState>();
  // A state is read at the next render: a second touch in the same frame would get through it.
  const working = useRef(false);
  const mounted = useMounted();

  const run = async (kind: 'pay' | 'undo', work: () => Promise<void>) => {
    if (working.current) {
      return;
    }
    working.current = true;
    setBusy(kind);
    try {
      await work();
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(undefined);
      }
    }
  };

  const live = new Set(view.operations.map((operation) => operation.id));
  if (queuing !== undefined) {
    live.add(queuing);
  }

  return {
    paid,
    live,
    busy,
    band,
    pay: (transfer) =>
      void run('pay', async () => {
        // The only transfer an operation cannot hold is one above the largest amount, which balances piled up over years could reach.
        if (transfer.amount > MAX_CENTS) {
          setBand({ kind: 'failed', error: 'too_large' });
          return;
        }
        const operation = settlementOf(transfer, {
          id: operationIdSchema.parse(crypto.randomUUID()),
          title: m.operation_reimbursement(),
          today: localDay(new Date()),
          revisionId: newRevisionId(),
          author: view.me,
        });
        const line: PaidTransfer = { transfer, operation: { id: operation.id, title: operation.title, date: operation.date } };
        setPaid((lines) => [...lines, line]);
        setQueuing(operation.id);
        const result = await view.enqueue(operation);
        if (!mounted.current) {
          return;
        }
        setQueuing(undefined);
        setBand(result.ok ? { kind: 'saved', paid: line } : { kind: 'failed', error: result.error });
      }),
    undo: (line) =>
      void run('undo', async () => {
        const result = await view.enqueue(deletionOf(line.operation, { revisionId: newRevisionId(), author: view.me }));
        if (mounted.current) {
          setBand(result.ok ? undefined : { kind: 'saved', paid: line, error: result.error });
        }
      }),
  };
}
