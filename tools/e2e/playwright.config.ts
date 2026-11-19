import { defineConfig, devices } from '@playwright/test';

const ci = process.env.CI !== undefined;

export default defineConfig({
  testDir: 'tests',
  globalSetup: './src/global-setup.ts',
  // One test at a time: the budgets measure a quiet machine, and the scenarios are few.
  workers: 1,
  forbidOnly: ci,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [['list'], ['github']] : 'list',
  use: { locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'allow', trace: ci ? 'off' : 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
