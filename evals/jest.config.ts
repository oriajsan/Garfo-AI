import { type Config } from 'jest';

/** Tests of the harness itself (schema, checks, report). They never touch the LLM or the database. */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
};

export default config;
