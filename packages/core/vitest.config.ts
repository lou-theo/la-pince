import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// The computation is about money: the whole core is covered.
export default mergeConfig(
  preset,
  defineConfig({
    test: {
      coverage: { thresholds: { 100: true } },
    },
  }),
);
