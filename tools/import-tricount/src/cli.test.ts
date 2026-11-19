import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

import { run } from './cli.ts';

const ADMIN_TOKEN = 'admin-token-of-the-cli-tests-0123456789';
const server = createTestHarness({ workers: [{ configPath: '../../apps/server/wrangler.jsonc', secrets: { ADMIN_TOKEN } }] });
let LA_PINCE_URL: string;

beforeAll(async () => {
  LA_PINCE_URL = (await server.listen()).url.href;
  await server.getWorker().applyD1Migrations('DB');
});

afterAll(async () => {
  await server.close();
});

const corpusPath = fileURLToPath(import.meta.resolve('@la-pince/core/fixtures/tricount-demo.json'));

const cli = async (args: string[], env: Record<string, string>) => {
  const lines: string[] = [];
  const code = await run({ args, env, print: (line) => lines.push(line) });
  return { code, lines };
};

describe('run', () => {
  it('imports the export file and prints the totals and the link of the group, under a new link token', async () => {
    const { code, lines } = await cli([corpusPath], { ADMIN_TOKEN, LA_PINCE_URL });
    expect(code).toBe(0);
    expect(lines.slice(0, 2)).toStrictEqual([
      'Groupe de démo: 250 revisions written, 0 of them deletions',
      "spent 9,609.80 €, reimbursed 1,024.16 €, balances equal to the export's to the cent",
    ]);
    const token = /: ([\w-]{43})$/.exec(lines[2] ?? '')?.[1];
    expect(lines[3]).toBe(`group: ${LA_PINCE_URL}api/groups/${String(token)}`);
    // The same link token next time keeps the link, and an identical export writes nothing.
    const again = await cli([corpusPath], { ADMIN_TOKEN, LA_PINCE_URL, LA_PINCE_GROUP_TOKEN: String(token) });
    expect(again.lines[0]).toBe('Groupe de démo: 0 revisions written, 0 of them deletions');
  });

  it('prints its usage without an export file or an admin token', async () => {
    expect((await cli([], { ADMIN_TOKEN })).code).toBe(2);
    expect((await cli([corpusPath], { ADMIN_TOKEN: '' })).code).toBe(2);
  });

  it('stops with an exit code on an export it cannot convert, or a refusal of the server', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'import-tricount-')), 'export.json');
    await writeFile(path, '{"Response": []}');
    const invalid = await cli([path], { ADMIN_TOKEN, LA_PINCE_URL });
    expect(invalid.code).toBe(1);
    expect(invalid.lines[0]).toMatch(/^import stopped: /);
    expect((await cli([corpusPath], { ADMIN_TOKEN: 'wrong', LA_PINCE_URL })).lines).toStrictEqual([
      expect.stringMatching(/^import stopped: PUT \/api\/admin\/groups\/[\w-]+: 401/) as string,
    ]);
  });

  it('lets an unexpected error through, before calling any server', async () => {
    // Without LA_PINCE_URL, the server of `wrangler dev`, never reached here.
    await expect(cli(['/nonexistent/export.json'], { ADMIN_TOKEN })).rejects.toThrow(/ENOENT/);
  });
});
