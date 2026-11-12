import { type Config } from 'jest';

/** End-to-end tests: the real AppModule over HTTP (Supertest) against the local Postgres. */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};

export default config;
