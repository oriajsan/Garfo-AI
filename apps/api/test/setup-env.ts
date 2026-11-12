import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Logger } from '@nestjs/common';

// Local runs: load the repository-root .env. Variables already set (CI) win.
// parseEnv + manual assignment, because Jest gives tests their own copy of process.env,
// which process.loadEnvFile (native) would not touch.
const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Keep test output readable: Nest logs (including expected error paths) are silenced.
Logger.overrideLogger(false);
