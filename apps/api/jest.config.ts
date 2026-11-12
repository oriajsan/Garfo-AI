import { type Config } from 'jest';

/** Unit and integration tests (`*.spec.ts` under src); integration ones need the local Postgres. */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  collectCoverageFrom: [
    'src/cart/**/*.ts',
    'src/tools/**/*.ts',
    'src/chat/agent.service.ts',
    // Declarative wiring with no logic of its own.
    '!**/*.module.ts',
    '!**/*.dto.ts',
  ],
  coveragePathIgnorePatterns: ['\\.spec\\.ts$'],
  coverageDirectory: 'coverage',
  // Only cart/ has a threshold in block 2; tools/ and agent.service.ts arrive in block 3.
  coverageThreshold: {
    global: {},
    './src/cart/': { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};

export default config;
