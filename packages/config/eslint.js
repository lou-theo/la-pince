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
      // Frontière entre paquets : un import doit être déclaré dans le package.json le plus proche, sinon Node le trouverait dans les dépendances d'outillage de la racine.
      'import-x/no-extraneous-dependencies': 'error',
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
      // Un montant nul (0 centime) est falsy : `if (montant)` le confondrait avec une absence.
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowNumber: false, allowString: false }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Les montants sont des centimes entiers.' }],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: 'Les montants sont des centimes entiers.' },
        { property: 'toFixed', message: 'Les montants sont des centimes entiers.' },
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
  // Après eslint-config-prettier, qui l'éteint alors qu'elle est compatible avec Prettier sous la forme « all ».
  { rules: { curly: ['error', 'all'] } },
);
