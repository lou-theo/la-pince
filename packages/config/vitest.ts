import { defineConfig } from 'vitest/config';

// Tests sit next to the code they cover; each package sets its own coverage thresholds.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
