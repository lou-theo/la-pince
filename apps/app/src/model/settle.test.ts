import {
  computeBalances,
  type Member,
  memberIdSchema,
  memberSchema,
  operationEffect,
  operationIdSchema,
  revisionIdSchema,
  type SuggestedTransfer,
  suggestTransfers,
} from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import type { BalanceLine } from './group.ts';
import { balanceContext, candidates, debtorCards, type PaidTransfer, settlementOf, transferRows } from './settle.ts';

const id = (value: string) => memberIdSchema.parse(value);
const opId = (value: string) => operationIdSchema.parse(value);
const membersOf = (count: number): Member[] =>
  Array.from({ length: count }, (_, index) => memberSchema.parse({ id: `m${String(index + 1)}`, name: `Membre ${String(index + 1)}` }));
const transfer = (from: string, to: string, amount: number) => ({ from, to, amount }) as SuggestedTransfer;
const paidOf = (line: SuggestedTransfer, operation: string): PaidTransfer => ({
  transfer: line,
  operation: { id: opId(operation), title: 'Remboursement', date: '2026-11-24' },
});
const settle = (line: SuggestedTransfer, operation = 'op-1') =>
  settlementOf(line, {
    id: opId(operation),
    title: 'Remboursement',
    today: '2026-11-24',
    revisionId: revisionIdSchema.parse('r-1'),
    author: id('m1'),
  });

describe('settlementOf', () => {
  it('records the transfer as a reimbursement of its amount to the cent, today, by who I am', () => {
    expect(settle(transfer('m2', 'm3', 2_318))).toStrictEqual({
      id: 'op-1',
      revisionId: 'r-1',
      title: 'Remboursement',
      date: '2026-11-24',
      author: 'm1',
      entry: { version: 1, kind: 'reimbursement', payer: 'm2', lines: [{ member: 'm3', amount: 2_318 }] },
    });
    for (const amount of [1, 99, 100, 123_456_789]) {
      expect(operationEffect(settle(transfer('m2', 'm3', amount)))).toStrictEqual({
        countsAsSpending: false,
        payer: 'm2',
        total: amount,
        shares: [{ member: 'm3', amount }],
      });
    }
  });

  it('settles the balances it was suggested for, to the cent', () => {
    // Balances of the demo group, summing to zero: paying every suggested transfer leaves everyone settled.
    const demo = [0, 6_850, -907, 3_548, -3_597, -1_499, -575, 1, -3_390, 2_602, -1_555, -1, -1_477];
    const balances = new Map(demo.map((balance, index) => [id(`m${String(index + 1)}`), balance]));
    const settlements = suggestTransfers(balances).map((line, index) => operationEffect(settle(line, `op-${String(index)}`)));
    const after = computeBalances(settlements.filter((effect) => effect !== undefined));
    for (const [member, balance] of balances) {
      expect(balance + (after.get(member) ?? 0)).toBe(0);
    }
  });

  it('refuses what is not a reimbursement, such as a transfer of nothing', () => {
    expect(() => settle(transfer('m2', 'm3', 0))).toThrow('does not read as a reimbursement');
  });
});

describe('transferRows', () => {
  const paid = paidOf(transfer('m2', 'm3', 500), 'op-paid');
  const undone = paidOf(transfer('m2', 'm4', 100), 'op-undone');

  it('puts the lines paid on the screen first, then those due, and drops one whose reimbursement is gone', () => {
    expect(transferRows([transfer('m2', 'm4', 100)], [paid, undone], new Set([opId('op-paid')]))).toStrictEqual([
      { kind: 'paid', ...paid },
      { kind: 'due', transfer: transfer('m2', 'm4', 100) },
    ]);
    expect(transferRows([], [], new Set())).toStrictEqual([]);
  });
});

describe('debtorCards', () => {
  const members = membersOf(4);
  const live = new Set([opId('op-a')]);

  it('keeps the order the screen opened with, a new debtor last, and the card of one who paid everything', () => {
    // m1 owed the most when the screen opened, then paid m3 all of it: m2 now owes more, m4 owes for the first time.
    const now = [transfer('m2', 'm3', 900), transfer('m4', 'm3', 50)];
    const paid = [paidOf(transfer('m1', 'm3', 1_000), 'op-a')];
    expect(debtorCards(now, members, paid, live, [id('m1'), id('m2')])).toStrictEqual([
      { debtor: 'm1', total: 0, rows: [{ kind: 'paid', ...paid[0] }] },
      { debtor: 'm2', total: 900, rows: [{ kind: 'due', transfer: now[0] }] },
      { debtor: 'm4', total: 50, rows: [{ kind: 'due', transfer: now[1] }] },
    ]);
  });

  it('drops the card of a debtor whose only line was undone, and orders like transfersByDebtor without an order', () => {
    const paid = [paidOf(transfer('m1', 'm3', 1_000), 'op-undone')];
    const now = [transfer('m4', 'm3', 50), transfer('m2', 'm3', 900)];
    expect(debtorCards(now, members, paid, live, []).map((card) => card.debtor)).toStrictEqual(['m2', 'm4']);
  });

  it('does not add the card twice of a debtor who still owes after a payment', () => {
    const paid = [paidOf(transfer('m2', 'm3', 100), 'op-a')];
    const cards = debtorCards([transfer('m2', 'm4', 300)], members, paid, live, [id('m2')]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.rows.map((row) => row.kind)).toStrictEqual(['paid', 'due']);
  });
});

describe('balanceContext', () => {
  const lines: BalanceLine[] = membersOf(3).map((member, index) => ({ member, balance: [500, -200, -300][index] ?? 0 }));

  it('says the balance of who gives, or of who receives until the giver is chosen, and nothing for a member it does not know', () => {
    expect(balanceContext(id('m2'), id('m1'), lines)?.balance).toBe(-200);
    expect(balanceContext(undefined, id('m1'), lines)?.balance).toBe(500);
    expect(balanceContext(undefined, undefined, lines)).toBeUndefined();
    expect(balanceContext(id('nobody'), undefined, lines)).toBeUndefined();
  });
});

describe('candidates', () => {
  it('offers the members in the order of the balances, without the other side nor a member who left the group', () => {
    const members = membersOf(3);
    const [m1, m2, m3] = members as [Member, Member, Member];
    const lines: BalanceLine[] = [
      { member: m3, balance: 500 },
      { member: { id: id('gone'), name: 'gone' }, balance: 100 },
      { member: m1, balance: 0 },
      { member: m2, balance: -600 },
    ];
    expect(candidates(lines, members, id('m1')).map((member) => member.id)).toStrictEqual(['m3', 'm2']);
    expect(candidates(lines, members, undefined).map((member) => member.id)).toStrictEqual(['m3', 'm1', 'm2']);
  });
});
