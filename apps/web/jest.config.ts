import { type Config } from 'jest';

/** Unit tests of the web app: only pure logic (the SSE parser, D4.4). */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          strict: true,
          target: 'ES2022',
          lib: ['ES2022', 'dom'],
        },
      },
    ],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};

export default config;
