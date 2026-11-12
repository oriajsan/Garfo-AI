module.exports = {
  overrides: [
    {
      files: ['*.ts'],
      extends: ['plugin:@typescript-eslint/recommended-type-checked', 'prettier'],
      parserOptions: { project: ['./tsconfig.eslint.json'], tsconfigRootDir: __dirname },
    },
  ],
};
