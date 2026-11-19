import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      // `bin.ts` only hands the process to `run`, which the tests call.
      coverage: { exclude: ['src/bin.ts'], thresholds: { 100: true } },
    },
  }),
);
