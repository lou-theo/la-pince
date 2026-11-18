import { defineConfig } from 'vitest/config';

// Tests à côté du code qu'ils couvrent ; chaque paquet fixe ses seuils de couverture.
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
