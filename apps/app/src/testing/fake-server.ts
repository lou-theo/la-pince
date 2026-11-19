import { type ApiError, type Change, changeSchema, changesResponseSchema, type GroupResponse, groupResponseSchema } from '@la-pince/core';

import type { Fetch } from '../sync/client.ts';

// Test helpers: a fake transport answering as `apps/server` does, every answer built through the schemas of the core.

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface FakeServer {
  readonly fetch: Fetch;
  /** URLs asked, in order. */
  readonly calls: string[];
}

/** Serves one group under its token, its changes by pages of `pageSize`; `answer` may replace the answer to a URL (failure, odd page). */
export function fakeServer({
  token,
  group,
  changes = [],
  pageSize = 500,
  answer,
}: {
  token: string;
  group: GroupResponse;
  changes?: readonly Change[];
  pageSize?: number;
  answer?: (url: string) => Promise<Response> | undefined;
}): FakeServer {
  const calls: string[] = [];
  const base = `/api/groups/${token}`;
  return {
    calls,
    fetch: (url) => {
      calls.push(url);
      const replaced = answer?.(url);
      if (replaced !== undefined) {
        return replaced;
      }
      if (url === base) {
        return Promise.resolve(json(groupResponseSchema.parse(group)));
      }
      const match = new RegExp(`^${base}/changes\\?since=(\\d+)$`).exec(url);
      if (match === null) {
        return Promise.resolve(json({ error: 'group_not_found' } satisfies ApiError, 404));
      }
      const since = Number(match[1]);
      const after = changes.filter((candidate) => candidate.seq > since).toSorted((a, b) => a.seq - b.seq);
      const page = after.slice(0, pageSize);
      return Promise.resolve(
        json(changesResponseSchema.parse({ changes: page, cursor: page.at(-1)?.seq ?? since, hasMore: after.length > pageSize })),
      );
    },
  };
}

let seq = 0;

/** A change of the fake server: an expense paid by `payer` with fixed amounts, a reimbursement, or a deletion; seqs grow with each call. */
export function change(fields: {
  id: string;
  date: string;
  title?: string;
  createdSeq?: number;
  payer?: string;
  lines?: readonly (readonly [string, number])[];
  kind?: 'expense' | 'reimbursement';
  author?: string;
  deleted?: boolean;
}): Change {
  seq += 1;
  const base = {
    id: fields.id,
    revisionId: `rev-${String(seq)}`,
    title: fields.title ?? `Opération ${fields.id}`,
    date: fields.date,
    seq,
    createdSeq: fields.createdSeq ?? seq,
    ...(fields.author === undefined ? {} : { author: fields.author }),
  };
  if (fields.deleted === true) {
    return changeSchema.parse({ ...base, deleted: true });
  }
  const lines = (fields.lines ?? [['m1', 1_000]]).map(([member, amount]) => ({ member, amount }));
  return changeSchema.parse({ ...base, entry: { version: 1, kind: fields.kind ?? 'expense', payer: fields.payer ?? 'm1', lines } });
}
