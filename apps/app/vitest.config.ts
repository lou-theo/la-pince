import preset from '@la-pince/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// The app's Vite plugins too: once Vite has run, Paraglide's output on disk points at modules that only its plugin serves.
export default mergeConfig(
  mergeConfig(viteConfig, preset),
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'happy-dom',
      setupFiles: ['src/test-setup.ts'],
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/testing/**', 'src/main.tsx', 'src/i18n/paraglide/'],
        // Pure functions of the model: fully covered.
        thresholds: { 'src/model/**': { 100: true } },
      },
    },
  }),
);
