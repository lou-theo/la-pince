import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      // The routes run in workerd (`createTestHarness`), out of reach of the coverage of Node: the API tests cover them, the threshold covers the
      // decisions about revisions, which run in Node.
      coverage: { exclude: ['src/index.ts', 'src/schema.ts'], thresholds: { 100: true } },
    },
  }),
);
