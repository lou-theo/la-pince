import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The part of a D1 binding the restore uses. */
export interface Database {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown>;
}

// In the order of their foreign keys: deleted backwards, filled forwards.
const tables = ['groups', 'members', 'revisions', 'operations'] as const;

/**
 * What Time Travel does to D1, played on the local database: `snapshot` keeps every table and the counter of the sync, `restore` puts them back.
 * SQLite keeps the counter of an `AUTOINCREMENT` key in `sqlite_sequence`, inside the database: once restored, the seqs written after the
 * snapshot are given again to the next revisions.
 */
export function databaseRestore(db: Database): { readonly snapshot: () => Promise<void>; readonly restore: () => Promise<void> } {
  const run = async (queries: readonly string[]) => {
    await db.batch(queries.map((query) => db.prepare(query)));
  };
  return {
    snapshot: () =>
      run([
        ...tables.flatMap((table) => [`DROP TABLE IF EXISTS snapshot_${table}`, `CREATE TABLE snapshot_${table} AS SELECT * FROM ${table}`]),
        'DROP TABLE IF EXISTS snapshot_sequence',
        "CREATE TABLE snapshot_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'revisions'",
      ]),
    restore: () =>
      run([
        ...tables.toReversed().map((table) => `DELETE FROM ${table}`),
        ...tables.map((table) => `INSERT INTO ${table} SELECT * FROM snapshot_${table}`),
        "UPDATE sqlite_sequence SET seq = (SELECT seq FROM snapshot_sequence) WHERE name = 'revisions'",
      ]),
  };
}

/**
 * Serves the snapshot and the restore to the tests, which run in other processes than the stack: `POST /snapshot`, `POST /restore`.
 */
export async function serveRestore(db: Database): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const { snapshot, restore } = databaseRestore(db);
  const server = createServer((request, response) => {
    const action = request.method === 'POST' ? { '/snapshot': snapshot, '/restore': restore }[request.url ?? ''] : undefined;
    if (action === undefined) {
      response.writeHead(404).end();
      return;
    }
    action().then(
      () => response.writeHead(204).end(),
      (error: unknown) => response.writeHead(500).end(String(error)),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}
