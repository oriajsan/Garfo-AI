/**
 * Shared ESLint base for the monorepo. Each package extends it and adds what it needs
 * (type-aware rules for the API and shared package, next/core-web-vitals for the web).
 */
module.exports = {
  root: true,
  ignorePatterns: ['node_modules', 'dist', '.next', 'coverage'],
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['*.js', '*.cjs', '*.mjs'],
      extends: ['eslint:recommended', 'prettier'],
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  ],
};
