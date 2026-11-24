import { MAX_CENTS, memberIdSchema, type Operation, type SuggestedTransfer } from '@la-pince/core';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { QueueResult } from '../sync/groupStore.ts';
import { UndoBanner } from './UndoBanner.tsx';
import { useSettle } from './useSettle.ts';
import type { GroupView } from './view.ts';

const alice = memberIdSchema.parse('m1');
const bruno = memberIdSchema.parse('m2');
const transfer = (amount: number): SuggestedTransfer => ({ from: bruno, to: alice, amount });

/** A group seen by Bruno whose outbox answers in turn with `answers`, then takes everything; `queued` records what it was handed. */
function viewOf(answers: QueueResult[]): { view: GroupView; queued: Operation[] } {
  const queued: Operation[] = [];
  const view: GroupView = {
    operations: [],
    balances: [],
    transfers: [],
    me: bruno,
    nameOf: (id) => (id === alice ? 'Alice' : 'Bruno'),
    members: [
      { id: alice, name: 'Alice' },
      { id: bruno, name: 'Bruno' },
    ],
    enqueue: (operation) => {
      queued.push(operation);
      return Promise.resolve(answers.shift() ?? { ok: true });
    },
    pendingCount: 0,
    readAt: 0,
  };
  return { view, queued };
}

describe('useSettle', () => {
  it('records one payment for two touches in the same frame', async () => {
    const { view, queued } = viewOf([]);
    const { result } = renderHook(() => useSettle(view));
    await act(async () => {
      result.current.pay(transfer(2_000));
      result.current.pay(transfer(2_000));
      await Promise.resolve();
    });
    expect(queued).toHaveLength(1);
    expect(result.current.paid).toHaveLength(1);
  });

  it('keeps “Annuler” when the phone could not store the undoing, so that it can be tried again', async () => {
    const { view, queued } = viewOf([{ ok: true }, { ok: false, error: 'not_stored' }]);
    const { result } = renderHook(() => useSettle(view));
    await act(async () => {
      result.current.pay(transfer(2_000));
      await Promise.resolve();
    });
    const [line] = result.current.paid;
    if (line === undefined) {
      throw new Error('no payment recorded');
    }
    await act(async () => {
      result.current.undo(line);
      await Promise.resolve();
    });
    expect(result.current.band).toStrictEqual({ kind: 'saved', paid: line, error: 'not_stored' });

    // The fake group shows no operation: the reimbursement is marked live as the outbox would show it.
    const band = render(<UndoBanner view={view} settle={{ ...result.current, live: new Set([line.operation.id]) }} />);
    expect(screen.getByRole('alert').textContent).toContain("Ce téléphone n'a pas pu garder ta saisie");
    expect(screen.getByRole('button', { name: 'Annuler ce remboursement' })).toBeDefined();
    band.unmount();

    await act(async () => {
      result.current.undo(line);
      await Promise.resolve();
    });
    expect(result.current.band).toBeUndefined();
    expect(queued.map((operation) => 'deleted' in operation)).toStrictEqual([false, true, true]);
  });

  it('records nothing for a transfer beyond the largest amount, and says why', async () => {
    const { view, queued } = viewOf([]);
    const { result } = renderHook(() => useSettle(view));
    await act(async () => {
      result.current.pay(transfer(MAX_CENTS + 1));
      await Promise.resolve();
    });
    expect(queued).toHaveLength(0);
    expect(result.current.paid).toHaveLength(0);
    expect(result.current.band).toStrictEqual({ kind: 'failed', error: 'too_large' });
    render(<UndoBanner view={view} settle={result.current} />);
    expect(screen.getByRole('alert').textContent).toBe('Le total dépasse le plus grand montant possible.');
  });
});
