module.exports = {
  overrides: [
    {
      files: ['*.ts'],
      extends: ['plugin:@typescript-eslint/recommended-type-checked', 'prettier'],
      parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: __dirname },
    },
  ],
};
