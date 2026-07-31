import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/prisma/migrations/**',
      '**/.data/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // TypeScript handles these; the core ruleset conflicts with it.
      'no-undef': 'off',
      // Always use `import type` for type-only imports.
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Architecture rule: no direct process.env outside the config package.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.type='Identifier'][object.name='process']",
          message: 'Do not touch `process` directly. Read values from the config package.',
        },
      ],
    },
  },
  {
    // The config package owns process.env access.
    files: ['packages/config/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Tests, scripts and tooling may use console and process freely.
    files: [
      '**/*.test.ts',
      '**/scripts/**',
      '**/prisma/**',
      '**/vitest.config.ts',
      'eslint.config.js',
    ],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.commonjs } },
  },
);
