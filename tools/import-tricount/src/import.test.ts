import { changesResponseSchema, computeBalances, computeEffect, convertTricount } from '@la-pince/core';
import corpus from '@la-pince/core/fixtures/tricount-demo.json' with { type: 'json' };
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import { ImportError, importTricount } from './import.ts';

// The server runs in workerd, on a local D1 migrated from its committed migrations, and the import calls it over HTTP as it would `wrangler dev`.
const adminToken = 'admin-token-of-the-tests-0123456789';
const server = createTestHarness({ workers: [{ configPath: '../../apps/server/wrangler.jsonc', secrets: { ADMIN_TOKEN: adminToken } }] });
let serverUrl: string;

beforeAll(async () => {
  serverUrl = (await server.listen()).url.href;
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

type Corpus = typeof corpus;

const registryOf = (data: Corpus) => {
  const [response] = data.Response;
  if (response === undefined) {
    throw new Error('the corpus holds one registry');
  }
  return response.Registry;
};

// Each test imports into its own group: the corpus under another group id, its operation ids prefixed, and its own link token.
let groups = 0;
const newCorpus = () => {
  groups += 1;
  const prefix = `g${String(groups)}-`;
  const copy = structuredClone(corpus);
  const registry = registryOf(copy);
  registry.uuid = `${prefix}${registry.uuid}`;
  for (const { RegistryEntry: entry } of registry.all_registry_entry) {
    entry.uuid = `${prefix}${entry.uuid}`;
  }
  return { data: copy, token: `${prefix}token-${'x'.repeat(32)}` };
};
const entries = (data: Corpus) => registryOf(data).all_registry_entry.map(({ RegistryEntry: entry }) => entry);

type Fetch = (url: URL, init?: RequestInit) => Promise<Response>;

const run = (data: unknown, token: string, options: { fetch?: Fetch; adminToken?: string } = {}) =>
  importTricount({ data, serverUrl, adminToken, token, ...options });

const changes = async (token: string) => {
  const response = await fetch(new URL(`/api/groups/${token}/changes`, serverUrl));
  return changesResponseSchema.parse(await response.json()).changes;
};

describe('importTricount', () => {
  it('imports the demo corpus: 9 609,80 € spent, 1 024,16 € reimbursed, balances read back equal to the export to the cent', async () => {
    const { data, token } = newCorpus();
    const report = await run(data, token);
    const group = convertTricount(data);
    expect(report).toStrictEqual({
      title: 'Groupe de démo',
      written: 250,
      deleted: 0,
      spent: 960_980,
      reimbursed: 102_416,
      balances: computeBalances(group.operations.map((operation) => computeEffect(operation.id, operation.entry))),
    });
    // Sent oldest first: operations get their `createdSeq` in the order they were entered, the reverse of Tricount's list.
    const read = await changes(token);
    expect(read.toSorted((a, b) => a.createdSeq - b.createdSeq).map((change) => change.id)).toStrictEqual(
      group.operations.map((operation) => operation.id).toReversed(),
    );
  });

  it('finishes an import stopped between two batches when run again, operations keeping the order they were entered', async () => {
    const { data, token } = newCorpus();
    let posts = 0;
    const cut: Fetch = async (url, init) => {
      if (init?.method === 'POST' && ++posts > 2) {
        throw new TypeError('network lost');
      }
      return fetch(url, init);
    };
    await expect(run(data, token, { fetch: cut })).rejects.toThrow('network lost');
    expect(await run(data, token)).toMatchObject({ written: 150, deleted: 0, spent: 960_980, reimbursed: 102_416 });
    const read = await changes(token);
    expect(read.toSorted((a, b) => a.createdSeq - b.createdSeq).map((change) => change.id)).toStrictEqual(
      convertTricount(data)
        .operations.map((operation) => operation.id)
        .toReversed(),
    );
  });

  it('counts once the revisions two imports of the same export send at the same time', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    registryOf(data).all_registry_entry.shift();
    const reports = await Promise.all([run(data, token), run(data, token)]);
    expect(reports.map((report) => report.written).reduce((sum, written) => sum + written)).toBe(1);
  });

  it('writes no revision when the same export is imported again', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    const before = await changes(token);
    expect(await run(data, token)).toMatchObject({ written: 0, deleted: 0 });
    expect(await changes(token)).toStrictEqual(before);
  });

  it('marks deleted an operation the export no longer holds, and writes a revision for one changed in Tricount', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    const [removed, changed] = entries(data);
    registryOf(data).all_registry_entry.shift();
    if (changed !== undefined) {
      changed.description = 'Renamed in Tricount';
    }
    expect(await run(data, token)).toMatchObject({ written: 2, deleted: 1, spent: 960_980 - 1020 });
    const read = await changes(token);
    expect(read.find((change) => change.id === removed?.uuid)).toMatchObject({ deleted: true, title: removed?.description });
    expect(read.find((change) => change.id === changed?.uuid)).toMatchObject({ title: 'Renamed in Tricount' });
  });

  it('brings back an operation deleted then put back in Tricount, under a new revision', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    const full = structuredClone(data);
    registryOf(data).all_registry_entry.shift();
    await run(data, token);
    expect(await run(full, token)).toMatchObject({ written: 1, deleted: 0, spent: 960_980 });
  });

  it('marks deleted an operation entered in La Pince, the export overwriting the group', async () => {
    const { data, token } = newCorpus();
    const report = await run(data, token);
    const [payer] = report.balances.keys();
    const operation = { id: `${token}-op`, revisionId: `${token}-op-r1`, title: 'Entered in La Pince', date: '2026-11-19' };
    const sent = await fetch(new URL(`/api/groups/${token}/operations`, serverUrl), {
      method: 'POST',
      body: JSON.stringify({
        operations: [{ ...operation, entry: { version: 1, kind: 'expense', payer, lines: [{ member: payer, amount: 500 }] } }],
      }),
    });
    expect(sent.status).toBe(200);
    expect(await run(data, token)).toMatchObject({ written: 1, deleted: 1 });
    expect((await changes(token)).find((change) => change.id === operation.id)).toMatchObject({ deleted: true });
  });

  it('stops on a revision the server rejects, here operations another group already holds', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    registryOf(data).uuid = `other-${registryOf(data).uuid}`;
    await expect(run(data, `other-${token}`)).rejects.toThrow(/revisions rejected by the server: [0-9a-f]{64}: operation_in_other_group/);
  });

  it('stops on a refusal of the server, here a wrong admin token, without printing the link token', async () => {
    const { data, token } = newCorpus();
    const error = await run(data, token, { adminToken: 'wrong' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as Error).message).toBe('PUT /api/admin/groups/' + registryOf(data).uuid + ': 401 {"error":"unauthorized"}');
    // A read that reaches no group, as if the link token had changed in between.
    const unknownGroup: Fetch = (url, init) => fetch(url.pathname.endsWith('/changes') ? new URL('/api/groups/unknown/changes', url) : url, init);
    await expect(run(data, token, { fetch: unknownGroup })).rejects.toThrow(/^GET \/api\/groups\/<token>\/changes\?since=0: 404/);
  });

  it('stops when the group read back differs from the export, balances included', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    // A server that sends back one cent more on a share of the first operation, total included.
    const lossy: Fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (!url.pathname.endsWith('/changes')) {
        return response;
      }
      const page = (await response.json()) as { changes: { entry: { payer: string; total: number; lines: { member: string; amount: number }[] } }[] };
      const [first] = page.changes;
      const line = first?.entry.lines.find((share) => share.member !== first.entry.payer);
      if (first !== undefined && line !== undefined) {
        line.amount += 1;
        first.entry.total += 1;
      }
      return Response.json(page);
    };
    await expect(run(data, token, { fetch: lossy })).rejects.toThrow(
      /differs from the export(.|\n)*balance of [\w-]+: -?\d+ read, -?\d+ from the export/,
    );
  });

  it('stops when the server acknowledges revisions it did not write', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    registryOf(data).all_registry_entry.shift();
    const forgetful: Fetch = async (url, init) => {
      if (init?.method !== 'POST' || typeof init.body !== 'string') {
        return fetch(url, init);
      }
      const { operations } = JSON.parse(init.body) as { operations: { revisionId: string }[] };
      return Response.json({ results: operations.map(({ revisionId }) => ({ revisionId, status: 'written', seq: 1 })) });
    };
    await expect(run(data, token, { fetch: forgetful })).rejects.toThrow(/differs from the export:\n[\w-]+: not in the export\nbalance of/);
  });

  it('stops on a page that does not follow its query', async () => {
    const { data, token } = newCorpus();
    await run(data, token);
    // A server that announces another page, then sends the first one again.
    let firstPage: object | undefined;
    const stale: Fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (!url.pathname.endsWith('/changes')) {
        return response;
      }
      firstPage ??= { ...((await response.json()) as object), hasMore: true };
      return Response.json(firstPage);
    };
    await expect(run(data, token, { fetch: stale })).rejects.toThrow(/^page read from \d+ does not follow its query$/);
  });
});
