import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { captures } from './run.ts';

const { values } = parseArgs({ options: { avant: { type: 'string' }, sortie: { type: 'string' } } });
// pnpm runs the script from its package: a relative output folder is read from where the command was typed.
const out = values.sortie === undefined ? undefined : resolve(process.env.INIT_CWD ?? process.cwd(), values.sortie);
const print = (line: string) => process.stdout.write(`${line}\n`);
if (!(await captures({ before: values.avant, out, print }))) {
  print('a screen is missing from the branch: see the lines marked absent');
  process.exitCode = 1;
}
