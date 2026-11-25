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
 * Opens the group as Bruno on a fake server holding one expense of Alice (45,00 €: 10,00 on her, 20,00 on Bruno, 15,00 on Chloé), and records what
 * the app posts, batch by batch and one after the other; `down` makes the requests it picks fail, `hold` keeps the server's answer to a post until
 * it settles.
 */
export async function openAsBruno(
  token: string,
  path: string,
  options: { down?: (url: string, init?: RequestInit) => boolean; hold?: Promise<void>; more?: Change[] } = {},
): Promise<{ user: ReturnType<typeof userEvent.setup>; location: ReturnType<typeof renderApp>; batches: Operation[][]; posted: Operation[] }> {
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
  const posted: Operation[] = [];
  const fetchFn: Fetch = (url, init) => {
    if (options.down?.(url, init) === true) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (init?.method === 'POST' && typeof init.body === 'string') {
      const { operations } = operationBatchSchema.parse(JSON.parse(init.body));
      batches.push(operations);
      posted.push(...operations);
      if (options.hold !== undefined) {
        return options.hold.then(() => server.fetch(url, init));
      }
    }
    return server.fetch(url, init);
  };
  await rememberMember(token, 'm2');
  const location = renderApp(`/g/${token}${path}`, fetchFn);
  // The band says who I am, or the title of the screen below a tab or of a form, or the group's on a sheet.
  await screen.findAllByText(/^(Tu es Bruno|Nouvelle dépense|Modifier la dépense|Remboursement|Remboursements suggérés|Soldes|Week-end)$/);
  return { user: userEvent.setup(), location, batches, posted };
}
