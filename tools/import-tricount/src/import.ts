import {
  type Balance,
  canonicalJson,
  type Change,
  changesQuerySchema,
  changesResponseSchema,
  computeBalances,
  computeEffect,
  convertTricount,
  type ImportedOperation,
  MAX_BATCH_REVISIONS,
  type MemberId,
  type Operation,
  operationBatchResponseSchema,
  operationEffect,
  type OperationId,
  operationSchema,
  pageFollowsQuery,
} from '@la-pince/core';

/** A failure the import reports and stops on: a refusal of the server, or a group read back that differs from the export. */
export class ImportError extends Error {}

export interface ImportOptions {
  /** The Tricount export, as read from its file. */
  readonly data: unknown;
  /** Where the server answers, `http://localhost:8787` for `wrangler dev`. */
  readonly serverUrl: string;
  readonly adminToken: string;
  /** The group's link token: a new one on the first import, the same one afterwards to keep the link. */
  readonly token: string;
  /** `fetch` by default; the tests put a faulty server in between. */
  readonly fetch?: (url: URL, init?: RequestInit) => Promise<Response>;
}

export interface ImportReport {
  readonly title: string;
  /** Revisions the server wrote: new or changed operations, then deletions. */
  readonly written: number;
  readonly deleted: number;
  /** Totals read back from the server, in cents. */
  readonly spent: number;
  readonly reimbursed: number;
  readonly balances: ReadonlyMap<MemberId, Balance>;
}

// An operation as the export wants it on the server: imported, or the mark of one deleted.
type Content = ImportedOperation | { readonly id: OperationId; readonly title: string; readonly date: string; readonly deleted: true };

const REVISION_FIELDS = new Set(['revisionId', 'seq', 'createdSeq']);

// What a revision says, whatever its revision id and seq: two revisions with the same content are the same state of the operation.
const contentOf = (operation: Content | Change): string =>
  canonicalJson(Object.fromEntries(Object.entries(operation).filter(([field]) => !REVISION_FIELDS.has(field))));

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex');
}

/**
 * Overwrites the group on the server with the export (decisions 10 and 28): title and members by the admin route, operations by the sync API, an
 * operation absent from the export being marked deleted. Then reads the group back and stops at the first difference with the export, balances
 * compared to the cent.
 */
export async function importTricount(options: ImportOptions): Promise<ImportReport> {
  const group = convertTricount(options.data);
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await (options.fetch ?? fetch)(new URL(path, options.serverUrl), init);
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new ImportError(`${init?.method ?? 'GET'} ${path.replace(options.token, '<token>')}: ${String(response.status)} ${JSON.stringify(body)}`);
    }
    return body;
  };
  await call(`/api/admin/groups/${group.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${options.adminToken}` },
    body: JSON.stringify({ title: group.title, token: options.token, members: group.members }),
  });
  const readAll = async (): Promise<Map<OperationId, Change>> => {
    const current = new Map<OperationId, Change>();
    let revision: string | undefined;
    for (let since = 0, hasMore = true; hasMore;) {
      const params = { since: String(since), ...(revision === undefined ? {} : { revision }) };
      const query = changesQuerySchema.parse(params);
      const page = changesResponseSchema.parse(await call(`/api/groups/${options.token}/changes?${new URLSearchParams(params).toString()}`));
      if (!pageFollowsQuery(query, page)) {
        throw new ImportError(`page read from ${String(since)} does not follow its query`);
      }
      for (const change of page.changes) {
        current.set(change.id, change);
      }
      ({ cursor: since, hasMore } = page);
      revision = page.changes.at(-1)?.revisionId ?? revision;
    }
    return current;
  };

  const before = await readAll();
  const exported = new Map(group.operations.map((operation) => [operation.id, operation]));
  // Tricount lists the newest first: sent oldest first, operations get their `createdSeq` in the order they were entered.
  const wanted: Content[] = [
    ...group.operations.toReversed(),
    ...[...before.values()]
      .filter((change) => !exported.has(change.id) && !('deleted' in change))
      .map((change): Content => ({ id: change.id, title: change.title, date: change.date, deleted: true })),
  ];
  const revisions: Operation[] = [];
  for (const content of wanted) {
    const current = before.get(content.id);
    const text = contentOf(content);
    if (current === undefined || contentOf(current) !== text) {
      // From the group, the content and the revision it replaces: going back to an earlier state is a new revision, not taken for a resend, and a
      // revision id stays the group's own.
      const revisionId = await sha256(`${group.id}\n${text}\n${current === undefined ? '' : String(current.seq)}`);
      revisions.push(operationSchema.parse({ ...content, revisionId }));
    }
  }
  let written = 0;
  for (let start = 0; start < revisions.length; start += MAX_BATCH_REVISIONS) {
    const { results } = operationBatchResponseSchema.parse(
      await call(`/api/groups/${options.token}/operations`, {
        method: 'POST',
        body: JSON.stringify({ operations: revisions.slice(start, start + MAX_BATCH_REVISIONS) }),
      }),
    );
    const rejected = results.flatMap((result) => (result.status === 'rejected' ? [`${result.revisionId}: ${result.reason}`] : []));
    if (rejected.length > 0) {
      throw new ImportError(`revisions rejected by the server: ${rejected.join(', ')}`);
    }
    // A revision another import of the same export sent meanwhile comes back as a duplicate.
    written += results.filter((result) => result.status === 'written').length;
  }

  const after = await readAll();
  const differences = [
    ...[...after.values()].flatMap((change) => (exported.has(change.id) || 'deleted' in change ? [] : [`${change.id}: not in the export`])),
    ...group.operations.flatMap((operation) => {
      const change = after.get(operation.id);
      return change !== undefined && contentOf(change) === contentOf(operation) ? [] : [`${operation.id}: differs from the export`];
    }),
  ];
  const effects = [...after.values()].flatMap((change) => {
    const effect = operationEffect(change);
    return effect === undefined ? [] : [effect];
  });
  const balances = computeBalances(effects);
  const expected = computeBalances(group.operations.map((operation) => computeEffect(operation.id, operation.entry)));
  for (const member of new Set([...balances.keys(), ...expected.keys()])) {
    if (balances.get(member) !== expected.get(member)) {
      differences.push(`balance of ${member}: ${String(balances.get(member))} read, ${String(expected.get(member))} from the export`);
    }
  }
  if (differences.length > 0) {
    throw new ImportError(`group read back differs from the export:\n${differences.join('\n')}`);
  }
  const total = (countsAsSpending: boolean) =>
    effects.filter((effect) => effect.countsAsSpending === countsAsSpending).reduce((sum, effect) => sum + effect.total, 0);
  return {
    title: group.title,
    written,
    deleted: revisions.filter((revision) => 'deleted' in revision).length,
    spent: total(true),
    reimbursed: total(false),
    balances,
  };
}
