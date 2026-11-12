import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@garfo/shared'],
  // Self-contained server for the Docker image. In a monorepo, tracing must start at the repo
  // root so files from the pnpm store and from packages/shared are copied too.
  output: 'standalone',
  experimental: { outputFileTracingRoot: repoRoot },
};

export default nextConfig;
