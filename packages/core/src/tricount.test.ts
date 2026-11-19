import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import corpus from '../fixtures/tricount-demo.json' with { type: 'json' };
import { computeBalances } from './balances.ts';
import { computeEffect } from './effect.ts';
import { suggestTransfers } from './transfers.ts';
import { convertTricount } from './tricount.ts';

const member = (uuid: string) => ({ RegistryMembershipNonUser: { uuid } });
const euros = (value: string) => ({ currency: 'EUR', value });

interface RawOperation {
  type_transaction?: string;
  amount?: { currency: string; value: string };
  membership_owned?: unknown;
  allocations?: unknown[];
  status?: string;
}

const exportOf = (operations: RawOperation[], members = ['alice', 'bob']) => ({
  Response: [
    {
      Registry: {
        title: 'Trip',
        memberships: members.map((uuid) => ({ RegistryMembershipNonUser: { uuid, alias: { display_name: uuid.toUpperCase() } } })),
        all_registry_entry: operations.map((operation, index) => ({
          RegistryEntry: {
            uuid: `op${String(index)}`,
            status: 'ACTIVE',
            description: `Operation ${String(index)}`,
            type_transaction: 'NORMAL',
            amount: euros('-10.00'),
            membership_owned: member('alice'),
            allocations: [
              { membership: member('alice'), amount: euros('-5.00') },
              { membership: member('bob'), amount: euros('-5.00') },
            ],
            date: '2026-11-16 15:56:50.945000',
            ...operation,
          },
        })),
      },
    },
  ],
});

describe('convertTricount', () => {
  it('converts an expense into exact amounts paid by its owner, leaving out zero shares', () => {
    const group = convertTricount(
      exportOf(
        [
          {
            amount: euros('-10.01'),
            allocations: [
              { membership: member('alice'), amount: euros('-3.33') },
              { membership: member('bob'), amount: euros('-6.68') },
              { membership: member('carol'), amount: euros('0.00') },
            ],
          },
        ],
        ['alice', 'bob', 'carol'],
      ),
    );
    expect(group.title).toBe('Trip');
    expect(group.members).toStrictEqual([
      { id: 'alice', name: 'ALICE' },
      { id: 'bob', name: 'BOB' },
      { id: 'carol', name: 'CAROL' },
    ]);
    expect(group.operations).toStrictEqual([
      {
        id: 'op0',
        title: 'Operation 0',
        date: '2026-11-16',
        entry: {
          version: 1,
          kind: 'expense',
          payer: 'alice',
          total: 1001,
          lines: [
            { member: 'alice', amount: 333 },
            { member: 'bob', amount: 668 },
          ],
        },
      },
    ]);
  });

  it('converts a balance entry into a reimbursement to the member allocated the amount', () => {
    const [operation] = convertTricount(
      exportOf([
        {
          type_transaction: 'BALANCE',
          amount: euros('-20.00'),
          allocations: [
            { membership: member('bob'), amount: euros('-20.00') },
            { membership: member('alice'), amount: euros('-0.00') },
          ],
        },
      ]),
    ).operations;
    expect(operation?.entry).toStrictEqual({
      version: 1,
      kind: 'reimbursement',
      payer: 'alice',
      total: 2000,
      lines: [{ member: 'bob', amount: 2000 }],
    });
  });

  it.each([
    ['an income', { amount: euros('10.00') }, 'income_not_supported'],
    ['an amount without two decimals', { amount: euros('-10.0') }, 'invalid_amount'],
    ['an amount above the cap', { amount: euros('-100000000.00') }, 'invalid_amount'],
    ['another currency', { amount: { currency: 'USD', value: '-10.00' } }, '"currency"'],
    ['allocations that do not add up to the amount', { amount: euros('-10.01') }, 'total_mismatch'],
    [
      'an operation without any non-zero allocation',
      { amount: euros('0.00'), allocations: [{ membership: member('bob'), amount: euros('0.00') }] },
      '"lines"',
    ],
    ['a member missing from the group', { membership_owned: member('mallory') }, 'unknown_member'],
    ['a membership wrapped with two kinds', { membership_owned: { A: { uuid: 'alice' }, B: { uuid: 'bob' } } }, 'invalid_membership'],
    ['a membership wrapped with no kind', { membership_owned: {} }, 'invalid_membership'],
    ['an unknown kind of operation', { type_transaction: 'INCOME' }, '"type_transaction"'],
    ['a deleted operation', { status: 'DELETED' }, '"status"'],
  ])('rejects %s', (_, operation, issue) => {
    expect(() => convertTricount(exportOf([operation]))).toThrow(ZodError);
    expect(() => convertTricount(exportOf([operation]))).toThrow(issue);
  });
});

// Anonymised export of the group's tricount on 16/11/2026: members renamed, titles invented, identifiers replaced; dates, amounts and splits kept.
describe('demo corpus', () => {
  const group = convertTricount(corpus);
  const effects = group.operations.map((operation) => computeEffect(operation.id, operation.entry));
  const names = new Map(group.members.map(({ id, name }) => [id, name]));

  it('keeps every member and operation', () => {
    expect([group.members.length, group.operations.length]).toStrictEqual([13, 250]);
  });

  it('finds the totals Tricount shows: 9 609,80 € spent and 1 024,16 € reimbursed', () => {
    const total = (countsAsSpending: boolean) =>
      effects.filter((effect) => effect.countsAsSpending === countsAsSpending).reduce((sum, effect) => sum + effect.total, 0);
    expect([total(true), total(false)]).toStrictEqual([960_980, 102_416]);
  });

  it('gives every operation the shares Tricount allocated, to the cent', () => {
    const allocated = corpus.Response[0]?.Registry.all_registry_entry.map(({ RegistryEntry: operation }) =>
      operation.allocations
        .map((allocation) => ({
          member: allocation.membership.RegistryMembershipNonUser.uuid,
          cents: -Number(allocation.amount.value.replace('.', '')),
        }))
        .filter((share) => share.cents !== 0)
        .toSorted((a, b) => (a.member < b.member ? -1 : 1)),
    );
    expect(effects.map((effect) => effect.shares.map((share) => ({ member: share.member, cents: share.amount })))).toStrictEqual(allocated);
  });

  it('finds the balances computed from Tricount allocations outside this code', () => {
    // Computed by a separate Python script over the same corpus (payer credited the amount, each member debited their allocation).
    const balances = Object.fromEntries([...computeBalances(effects)].map(([id, balance]) => [names.get(id) ?? id, balance]));
    expect(balances).toStrictEqual({
      Agathe: 4224,
      Basile: 1637,
      Capucine: -3597,
      Désiré: -9608,
      Eulalie: 1190,
      Firmin: 1035,
      Gaspard: 1,
      Honorine: -1564,
      Isidore: 4402,
      Joséphine: 3548,
      Léandre: 210,
      Mélusine: -1,
      Octave: -1477,
    });
  });

  it('settles the group in 12 transfers', () => {
    expect(suggestTransfers(computeBalances(effects))).toHaveLength(12);
  });
});
