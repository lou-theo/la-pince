import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import corpus from '../fixtures/tricount-demo.json' with { type: 'json' };
import { computeBalances } from './balances.ts';
import { computeEffect } from './effect.ts';
import { suggestTransfers } from './transfers.ts';
import { convertTricount } from './tricount.ts';

const member = (uuid: string) => ({ RegistryMembershipNonUser: { uuid } });
const euros = (value: string) => ({ currency: 'EUR', value });
const share = (uuid: string, value: string) => ({ membership: member(uuid), amount: euros(value) });

const exportOf = (operations: Record<string, unknown>[], { members = ['alice', 'bob'], pagination = {} } = {}) => ({
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
            allocations: [share('alice', '-5.00'), share('bob', '-5.00')],
            date: '2026-11-16 15:56:50.945000',
            ...operation,
          },
        })),
      },
    },
  ],
  Pagination: { future_url: null, newer_url: null, older_url: null, ...pagination },
});

describe('convertTricount', () => {
  it('converts an expense into exact amounts paid by its owner, leaving out zero shares', () => {
    const group = convertTricount(
      exportOf([{ amount: euros('-10.01'), allocations: [share('alice', '-3.33'), share('bob', '-6.68'), share('carol', '0.00')] }], {
        members: ['alice', 'bob', 'carol'],
      }),
    );
    expect(group).toStrictEqual({
      title: 'Trip',
      members: [
        { id: 'alice', name: 'ALICE' },
        { id: 'bob', name: 'BOB' },
        { id: 'carol', name: 'CAROL' },
      ],
      operations: [
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
      ],
    });
  });

  it('converts a balance entry into a reimbursement to the member allocated the amount', () => {
    const [operation] = convertTricount(
      exportOf([{ type_transaction: 'BALANCE', amount: euros('-20.00'), allocations: [share('bob', '-20.00'), share('alice', '-0.00')] }]),
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
    ['an income', [{ amount: euros('10.00'), allocations: [share('alice', '5.00'), share('bob', '5.00')] }], 'income_not_supported'],
    ['a positive share in an expense', [{ allocations: [share('alice', '-15.00'), share('bob', '5.00')] }], 'income_not_supported'],
    ['an amount without two decimals', [{ amount: euros('-10.0') }], 'invalid_amount'],
    ['an amount above the cap', [{ amount: euros('-100000000.00') }], 'invalid_amount'],
    ['another currency', [{ amount: { currency: 'USD', value: '-10.00' } }], '"currency"'],
    ['shares that do not add up to the amount', [{ amount: euros('-10.01') }], 'total_mismatch'],
    ['an operation without any non-zero share', [{ amount: euros('0.00'), allocations: [share('bob', '0.00')] }], 'too_small'],
    ['a member allocated twice', [{ allocations: [share('alice', '-10.00'), share('alice', '0.00')] }], 'duplicate_allocation'],
    [
      'a reimbursement to two members',
      [{ type_transaction: 'BALANCE', allocations: [share('alice', '-5.00'), share('bob', '-5.00')] }],
      'unsupported_reimbursement',
    ],
    ['a reimbursement to its payer', [{ type_transaction: 'BALANCE', allocations: [share('alice', '-10.00')] }], 'unsupported_reimbursement'],
    ['a member missing from the group', [{ membership_owned: member('mallory') }], 'unknown_member'],
    [
      'a member missing from the group with a zero share',
      [{ allocations: [share('alice', '-5.00'), share('bob', '-5.00'), share('mallory', '0.00')] }],
      'unknown_member',
    ],
    ['an amount with an unexpected field', [{ amount: { currency: 'EUR', value: '-10.00', rate: '1' } }], 'unrecognized_keys'],
    ['two operations with the same identifier', [{ uuid: 'op' }, { uuid: 'op' }], 'duplicate_operation'],
    ['a membership wrapped with two kinds', [{ membership_owned: { A: { uuid: 'alice' }, B: { uuid: 'bob' } } }], 'invalid_membership'],
    ['a membership wrapped with no kind', [{ membership_owned: {} }], 'invalid_membership'],
    ['an unknown kind of operation', [{ type_transaction: 'INCOME' }], '"type_transaction"'],
    ['a deleted operation', [{ status: 'DELETED' }], '"status"'],
    ['a day that does not exist', [{ date: '2026-02-30 12:00:00.000000' }], 'invalid_date'],
    ['a date without a time', [{ date: '2026-11-16' }], 'invalid_date'],
  ])('rejects %s', (_, operations, issue) => {
    const convert = () => convertTricount(exportOf(operations));
    expect(convert).toThrow(ZodError);
    expect(convert).toThrow(issue);
  });

  it('rejects a member listed twice', () => {
    expect(() => convertTricount(exportOf([], { members: ['alice', 'alice'] }))).toThrow('duplicate_member');
  });

  it('rejects an export that announces another page', () => {
    expect(() => convertTricount(exportOf([], { pagination: { older_url: '/older' } }))).toThrow('partial_export');
  });

  it.each([
    ['shares that do not add up', { amount: euros('-10.01') }, 'all_registry_entry.1.RegistryEntry.entry.total'],
    ['a repeated identifier', { uuid: 'op0' }, 'all_registry_entry.1'],
    ['a member missing from the group', { membership_owned: member('mallory') }, 'all_registry_entry.1'],
  ])('locates %s in the faulty operation', (_, operation, path) => {
    const result = (() => {
      try {
        return convertTricount(exportOf([{}, operation]));
      } catch (error) {
        return error;
      }
    })();
    expect(result).toBeInstanceOf(ZodError);
    expect((result as ZodError).issues.map((issue) => issue.path.join('.'))).toStrictEqual([`Response.0.Registry.${path}`]);
  });
});

// Anonymised export of the group's tricount on 16/11/2026: members renamed, titles invented, identifiers replaced; dates, amounts and splits kept.
describe('demo corpus', () => {
  const group = convertTricount(corpus);
  const effects = group.operations.map((operation) => computeEffect(operation.id, operation.entry));
  const balances = computeBalances(effects);
  const names = new Map(group.members.map(({ id, name }) => [id, name]));

  it('keeps every member and operation', () => {
    expect([group.members.length, group.operations.length]).toStrictEqual([13, 250]);
  });

  it('finds 9 609,80 € spent, as the Tricount app shows, and 1 024,16 € reimbursed', () => {
    const total = (countsAsSpending: boolean) =>
      effects.filter((effect) => effect.countsAsSpending === countsAsSpending).reduce((sum, effect) => sum + effect.total, 0);
    expect([total(true), total(false)]).toStrictEqual([960_980, 102_416]);
  });

  it('gives every operation the payer and the shares of the export, to the cent', () => {
    // Read from the raw corpus, without the conversion: payer, then non-zero shares in cents, ordered by member.
    const expected = corpus.Response[0]?.Registry.all_registry_entry.map(({ RegistryEntry: operation }) => ({
      payer: operation.membership_owned.RegistryMembershipNonUser.uuid,
      shares: operation.allocations
        .map((allocation) => ({
          member: allocation.membership.RegistryMembershipNonUser.uuid,
          cents: -Number(allocation.amount.value.replace('.', '')),
        }))
        .filter((line) => line.cents !== 0)
        .toSorted((a, b) => (a.member < b.member ? -1 : 1)),
    }));
    const actual = effects.map((effect) => ({
      payer: effect.payer,
      shares: effect.shares.map((line) => ({ member: line.member, cents: line.amount })),
    }));
    expect(actual).toStrictEqual(expected);
  });

  it('finds the balances computed from the export outside this code', () => {
    // From a Python script over the same corpus, without this code: the owner of each operation credited its amount, each allocated member
    // debited their allocation.
    const byName = Object.fromEntries([...balances].map(([id, balance]) => [names.get(id) ?? id, balance]));
    expect(byName).toStrictEqual({
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

  it('suggests transfers that settle every balance', () => {
    const settled = new Map(balances);
    for (const transfer of suggestTransfers(balances)) {
      settled.set(transfer.from, (settled.get(transfer.from) ?? 0) + transfer.amount);
      settled.set(transfer.to, (settled.get(transfer.to) ?? 0) - transfer.amount);
    }
    expect([...settled.values()].every((balance) => balance === 0)).toBe(true);
  });
});
