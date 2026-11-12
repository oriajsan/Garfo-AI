// Loads the repository-root .env (if present) and runs the given command with it.
// Variables already set in the environment win, so CI and Docker are unaffected.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(1);
}

const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
