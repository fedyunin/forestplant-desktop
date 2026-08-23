/**
 * Code checks.
 *
 * The rules are picked for cause, not for fashion: they catch what actually
 * broke here — undeclared variables, forgotten awaits, empty blocks. Style
 * nitpicks such as line length are left out on purpose, so the check does not
 * turn into noise that people start switching off.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'db/**', 'kml/**'] },

  js.configs.recommended,

  // Core, main process, command line — a Node environment
  {
    files: ['src/core/**/*.js', 'src/main/**/*.js', 'src/cli/**/*.js',
      'src/exporters/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'require-await': 'error',
      'no-return-await': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // CommonJS wrappers
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },

  // The window: a browser environment, data access only through window.api.
  // ES modules — the renderer loads app.js as a module and imports i18n.js.
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
