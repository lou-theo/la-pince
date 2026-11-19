import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  preset,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'happy-dom',
      setupFiles: ['src/test-setup.ts'],
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/main.tsx', 'src/i18n/paraglide/'],
        // Pure functions of the model (amounts, shares, order of members): fully covered.
        thresholds: { 'src/model/**': { 100: true } },
      },
    },
  }),
);
