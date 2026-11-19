import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { captures } from './run.ts';

const { values } = parseArgs({ options: { avant: { type: 'string' }, sortie: { type: 'string' } } });
// pnpm runs the script from its package: a relative output folder is read from where the command was typed.
const out = values.sortie === undefined ? undefined : resolve(process.env.INIT_CWD ?? process.cwd(), values.sortie);
await captures({ before: values.avant, out, print: (line) => process.stdout.write(`${line}\n`) });
