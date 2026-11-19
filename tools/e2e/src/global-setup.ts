import { groups } from './groups.ts';
import { startStack } from './stack.ts';

/** Starts the stack once for the run; the tests read where it answers from the environment, which Playwright hands to its workers. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack(groups);
  process.env.E2E_APP_URL = stack.appUrl;
  process.env.E2E_DIST = stack.dist;
  return stack.close;
}
