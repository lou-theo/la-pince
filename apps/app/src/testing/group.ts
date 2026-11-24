import { type Change, groupResponseSchema, type Operation, operationBatchSchema } from '@la-pince/core';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import type { Fetch } from '../sync/client.ts';
import { change, fakeServer } from './fake-server.ts';
import { rememberMember } from './groupDb.ts';
import { renderApp } from './render.tsx';

export const testGroup = groupResponseSchema.parse({
  title: 'Week-end',
  members: [
    { id: 'm1', name: 'Alice' },
    { id: 'm2', name: 'Bruno' },
    { id: 'm3', name: 'Chloé' },
  ],
});

/**
 * Opens the group as Bruno on a fake server holding one expense of Alice (45,00 €: 10,00 on her, 20,00 on Bruno, 15,00 on Chloé), and records the
 * batches the app posts; `offline` makes every request fail until it returns false.
 */
export async function openAsBruno(
  token: string,
  path: string,
  options: { offline?: () => boolean; more?: Change[] } = {},
): Promise<{ user: ReturnType<typeof userEvent.setup>; location: ReturnType<typeof renderApp>; batches: Operation[][] }> {
  const changes: Change[] = [
    change({
      id: 'op-shopping',
      date: '2026-11-05',
      title: 'Courses',
      payer: 'm1',
      lines: [
        ['m1', 1_000],
        ['m2', 2_000],
        ['m3', 1_500],
      ],
    }),
    ...(options.more ?? []),
  ];
  const server = fakeServer({ token, group: testGroup, changes });
  const batches: Operation[][] = [];
  const fetchFn: Fetch = (url, init) => {
    if (options.offline?.() === true) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (init?.method === 'POST' && typeof init.body === 'string') {
      batches.push(operationBatchSchema.parse(JSON.parse(init.body)).operations);
    }
    return server.fetch(url, init);
  };
  await rememberMember(token, 'm2');
  const location = renderApp(`/g/${token}${path}`, fetchFn);
  // The band says who I am, or the title of the screen below a tab or of a form.
  await screen.findAllByText(/^(Tu es Bruno|Remboursement|Remboursements suggérés|Soldes)$/);
  return { user: userEvent.setup(), location, batches };
}
