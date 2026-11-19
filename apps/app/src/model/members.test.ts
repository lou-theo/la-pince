import { memberIdSchema, memberSchema } from '@la-pince/core';
import { describe, expect, it } from 'vitest';

import { change } from '../testing/fake-server.ts';
import { liveOperations } from './group.ts';
import { selectionOrder } from './members.ts';

const members = ['Alice', 'Bruno', 'Chloé', 'Denis', 'Emma'].map((name, index) => memberSchema.parse({ id: `m${String(index + 1)}`, name }));
const names = (order: readonly { name: string }[]) => order.map((member) => member.name);

describe('selectionOrder', () => {
  it('puts who I am first, then the members named most over the 90 days before the last operation, ties in the order they were added', () => {
    const operations = liveOperations([
      // Last operation on 1 March: the window starts after 1 December.
      change({ id: 'a', date: '2026-03-01', payer: 'm4', lines: [['m3', 100]] }),
      change({ id: 'b', date: '2025-12-02', payer: 'm3', lines: [['m5', 100]] }),
      // Out of the window, at 90 days: it does not count.
      change({
        id: 'c',
        date: '2025-12-01',
        payer: 'm2',
        lines: [
          ['m2', 100],
          ['m5', 100],
        ],
      }),
    ]);
    // Chloé 2, Denis 1, Emma 1, Alice 0 then Bruno 0; Bruno is who I am.
    expect(names(selectionOrder(members, memberIdSchema.parse('m2'), operations))).toStrictEqual(['Bruno', 'Chloé', 'Denis', 'Emma', 'Alice']);
  });

  it('counts a member once per operation, as payer and with a share', () => {
    const operations = liveOperations([
      change({ id: 'a', date: '2026-03-01', payer: 'm5', lines: [['m5', 100]] }),
      change({ id: 'b', date: '2026-03-01', payer: 'm4', lines: [['m3', 100]] }),
    ]);
    expect(names(selectionOrder(members, memberIdSchema.parse('m1'), operations))).toStrictEqual(['Alice', 'Chloé', 'Denis', 'Emma', 'Bruno']);
  });

  it('keeps the order members were added in a group without operations', () => {
    expect(names(selectionOrder(members, memberIdSchema.parse('m3'), []))).toStrictEqual(['Chloé', 'Alice', 'Bruno', 'Denis', 'Emma']);
  });
});
