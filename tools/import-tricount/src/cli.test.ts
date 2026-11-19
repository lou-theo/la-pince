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
  it('imports the export file under a new link token printed first, then the totals; the same token next time keeps the link', async () => {
    const { code, lines } = await cli([corpusPath], { ADMIN_TOKEN, LA_PINCE_URL, LA_PINCE_APP_URL: '', LA_PINCE_NEW_LINK: '1' });
    expect(code).toBe(0);
    const token = /: ([\w-]{43})$/.exec(lines[0] ?? '')?.[1];
    expect(lines.slice(1)).toStrictEqual([
      `group: http://localhost:5173/g/${String(token)}`,
      'Groupe de démo: 250 revisions written, 0 of them deletions',
      "spent 9 609,80 €, reimbursed 1 024,16 €, balances equal to the export's to the cent",
    ]);
    const again = await cli([corpusPath], {
      ADMIN_TOKEN,
      LA_PINCE_URL,
      LA_PINCE_APP_URL: 'https://la-pince.example',
      LA_PINCE_GROUP_TOKEN: String(token),
    });
    expect(again.lines.slice(0, 3)).toStrictEqual([
      lines[0],
      `group: https://la-pince.example/g/${String(token)}`,
      'Groupe de démo: 0 revisions written, 0 of them deletions',
    ]);
  });

  it('prints its usage without an export file, an admin token, or a choice between the link token and a new one', async () => {
    expect((await cli([], { ADMIN_TOKEN, LA_PINCE_NEW_LINK: '1' })).code).toBe(2);
    expect((await cli([corpusPath], { ADMIN_TOKEN: '', LA_PINCE_NEW_LINK: '1' })).code).toBe(2);
    expect((await cli([corpusPath], { ADMIN_TOKEN })).code).toBe(2);
    expect((await cli([corpusPath], { ADMIN_TOKEN, LA_PINCE_GROUP_TOKEN: 'y'.repeat(32), LA_PINCE_NEW_LINK: '1' })).code).toBe(2);
  });

  it('stops with an exit code on a file it cannot read, an export it cannot convert, or a refusal of the server', async () => {
    // Without LA_PINCE_URL, the server of `wrangler dev`, never reached here.
    expect(await cli(['/nonexistent/export.json'], { ADMIN_TOKEN, LA_PINCE_NEW_LINK: '1' })).toStrictEqual({
      code: 1,
      lines: [expect.stringMatching(/^import stopped: cannot read \/nonexistent\/export.json: ENOENT/) as string],
    });
    const path = join(await mkdtemp(join(tmpdir(), 'import-tricount-')), 'export.json');
    await writeFile(path, '{"Response": []}');
    const invalid = await cli([path], { ADMIN_TOKEN, LA_PINCE_URL, LA_PINCE_NEW_LINK: '1' });
    expect([invalid.code, invalid.lines[2]]).toStrictEqual([1, expect.stringMatching(/^import stopped: /) as string]);
    expect((await cli([corpusPath], { ADMIN_TOKEN: 'wrong', LA_PINCE_URL, LA_PINCE_NEW_LINK: '1' })).lines[2]).toMatch(
      /^import stopped: PUT \/api\/admin\/groups\/[\w-]+: 401/,
    );
  });

  it('lets an unexpected error through, here a server that does not answer', async () => {
    await expect(cli([corpusPath], { ADMIN_TOKEN, LA_PINCE_URL: 'http://127.0.0.1:9/', LA_PINCE_NEW_LINK: '1' })).rejects.toThrow(TypeError);
  });
});
