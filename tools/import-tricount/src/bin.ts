import { run } from './cli.ts';

process.exitCode = await run({ args: process.argv.slice(2), env: process.env, print: (line) => process.stdout.write(`${line}\n`) });
