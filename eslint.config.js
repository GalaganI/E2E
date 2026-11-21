// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      '.tools/',
      'reports/',
      'test-results/',
      '.features-gen/',
      'playwright-report/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
  {
    // Playwright requires object destructuring for fixture parameters, even when empty.
    files: ['src/fixtures/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'features/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    settings: { playwright: { globalAliases: { test: ['Given', 'When', 'Then'] } } },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-force-option': 'error',
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
      'playwright/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expect.poll', 'actor.attemptsTo', 'expectApiSuccess'] },
      ],
    },
  },
  {
    // Gherkin steps are not tests: Given/When steps arrange and act, only Then steps assert.
    files: ['features/steps/**/*.ts'],
    rules: { 'playwright/expect-expect': 'off', 'playwright/no-conditional-in-test': 'off' },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
