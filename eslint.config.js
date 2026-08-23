/**
 * Проверка кода.
 *
 * Правила подобраны по делу, а не по моде: ловим то, что реально ломалось —
 * необъявленные переменные, забытые await, пустые блоки. Стилевые придирки
 * вроде длины строки не включены намеренно, чтобы проверка не превращалась
 * в шум, который начинают отключать.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'db/**', 'kml/**'] },

  js.configs.recommended,

  // Ядро, главный процесс, командная строка — среда Node
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

  // Обёртки на CommonJS
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },

  // Окно: браузерная среда, доступ к данным только через window.api
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
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
