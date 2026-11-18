import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// Le calcul porte sur de l'argent : tout le cœur est couvert.
export default mergeConfig(
  preset,
  defineConfig({
    test: {
      coverage: { thresholds: { 100: true } },
    },
  }),
);
