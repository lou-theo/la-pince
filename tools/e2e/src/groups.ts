import type { GroupSpec } from './stack.ts';

/** Scenarios that change their group: each gets one per browser, so that no scenario sees another's writes. */
export const scenarios = ['offline', 'refusal', 'overwrite', 'update', 'restore'] as const;
export type Scenario = (typeof scenarios)[number];
export const browsers = ['chromium', 'webkit'] as const;

// Tokens of groups that only live in the local D1 of a run.
export const tokenFor = (browser: string, scenario: Scenario | 'budgets' | 'notifications'): string => `e2e-${browser}-${scenario}`.padEnd(40, '0');

/** The group the budgets are measured on: the corpus repeated 10 times, about 2,500 operations (decision 35 g). */
export const budgetGroup: GroupSpec = { token: tokenFor('chromium', 'budgets'), copies: 10 };

export const groups: readonly GroupSpec[] = [
  ...browsers.flatMap((browser) => scenarios.map((scenario) => ({ token: tokenFor(browser, scenario) }))),
  budgetGroup,
  // Notifications are tested on Chromium only (playwright.config.ts).
  { token: tokenFor('chromium', 'notifications') },
];
