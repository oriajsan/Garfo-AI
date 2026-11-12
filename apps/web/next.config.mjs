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
  // The app does not use next/image. This disables the /_next/image optimizer, which is affected
  // by the critical Next 14 advisories (GHSA-2464-fhr4-w9xw, GHSA-2xp9-vwfh-vxw4, etc.) until
  // the migration to Next 15.
  images: { unoptimized: true },
  experimental: { outputFileTracingRoot: repoRoot },
};

export default nextConfig;
