import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/coverage/', '**/dist/', '.claude/', 'docs/cadrage/essais/', 'temp/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    plugins: { 'import-x': importX, 'simple-import-sort': simpleImportSort },
    rules: {
      eqeqeq: ['error', 'always'],
      // Package boundary: an import must be declared in the nearest package.json, otherwise Node would find it among the root's tooling dependencies; dev dependencies are for tests and configs only.
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: ['**/*.test.ts', '**/vitest.config.ts', '**/drizzle.config.ts', 'eslint.config.js'] },
      ],
      'no-console': 'error',
      'no-param-reassign': 'error',
      'object-shorthand': 'error',
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      // A zero amount (0 cents) is falsy: `if (amount)` would mistake it for a missing value.
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowNumber: false, allowString: false }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Amounts are whole cents.' }],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: 'Amounts are whole cents.' },
        { property: 'toFixed', message: 'Amounts are whole cents.' },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    extends: [vitest.configs.recommended],
    rules: {
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/no-focused-tests': 'error',
      'vitest/prefer-strict-equal': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
  // After eslint-config-prettier, which turns it off although its “all” form is compatible with Prettier.
  { rules: { curly: ['error', 'all'] } },
);
