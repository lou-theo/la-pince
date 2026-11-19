import { readFile } from 'node:fs/promises';

import { ZodError } from 'zod';

import { ImportError, importTricount } from './import.ts';

export interface CliOptions {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly print: (line: string) => void;
}

const euros = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;

// 32 random bytes: far beyond guessing, and within the 32 to 128 characters of the link token.
const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/**
 * Imports a Tricount export file into the server and prints what it did; returns the exit code. The link token is printed, never written to a
 * file: whoever has it can write to the group.
 */
export async function run({ args, env, print }: CliOptions): Promise<number> {
  const [path] = args;
  const adminToken = env.ADMIN_TOKEN;
  const given = env.LA_PINCE_GROUP_TOKEN;
  const hasToken = given !== undefined && given !== '';
  // A new link token replaces the group's link at once: only on demand, so that a forgotten variable never breaks the link the group uses.
  if (path === undefined || adminToken === undefined || adminToken === '' || hasToken === (env.LA_PINCE_NEW_LINK === '1')) {
    print('usage: ADMIN_TOKEN=… [LA_PINCE_URL=…] (LA_PINCE_GROUP_TOKEN=… | LA_PINCE_NEW_LINK=1) pnpm start <tricount export.json>');
    return 2;
  }
  const serverUrl = env.LA_PINCE_URL ?? 'http://localhost:8787';
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    print(`import stopped: cannot read ${path}: ${(error as Error).message}`);
    return 1;
  }
  const token = hasToken ? given : newToken();
  // Printed before any call: the server may hold it even if the import stops.
  print(`link token, to keep out of any file (LA_PINCE_GROUP_TOKEN for the next import): ${token}`);
  print(`group: ${new URL(`/api/groups/${token}`, serverUrl).href}`);
  try {
    const report = await importTricount({ data, serverUrl, adminToken, token });
    print(`${report.title}: ${String(report.written)} revisions written, ${String(report.deleted)} of them deletions`);
    print(`spent ${euros(report.spent)}, reimbursed ${euros(report.reimbursed)}, balances equal to the export's to the cent`);
    return 0;
  } catch (error) {
    if (error instanceof ImportError || error instanceof ZodError) {
      print(`import stopped: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
