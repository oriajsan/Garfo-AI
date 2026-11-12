// NEXT_PUBLIC_* values are inlined at build time, so each one must be referenced literally.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(
  /\/+$/,
  '',
);
export const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? '';
