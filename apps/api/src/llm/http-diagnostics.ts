import { Logger } from '@nestjs/common';

type RequestInitLike = Parameters<typeof fetch>[1];
export type FetchLike = (url: string | URL, init?: RequestInitLike) => Promise<Response>;

export const MAX_LOGGED_BODY_CHARS = 4096;

export interface DiagnosticLogger {
  warn(message: string): void;
}

export function truncate(text: string, max = MAX_LOGGED_BODY_CHARS): string {
  return text.length > max
    ? `${text.slice(0, max)}... [truncated ${text.length - max} chars]`
    : text;
}

/**
 * Fetch for the OpenAI client that logs status and body of every non-2xx response and returns
 * the response (error bodies normalised for the SDK, see below). Never logs headers (they carry the API key) or the query string.
 */
export function createDiagnosticFetch(
  logger: DiagnosticLogger = new Logger('LlmHttp'),
  baseFetch: FetchLike = (url, init) => fetch(url, init),
): FetchLike {
  return async (url, init) => {
    const response = await baseFetch(url, init);
    if (!response.ok) {
      const body = await response
        .clone()
        .text()
        .catch(() => '');
      logger.warn(
        JSON.stringify({
          event: 'llm_http_error',
          status: response.status,
          url: safeUrl(url),
          body: truncate(body),
        }),
      );
    }
    return response.ok ? response : await normalizeErrorResponse(response);
  };
}

/**
 * The SDK only reads `body.error`; Gemini answers errors as `[{ "error": {...} }]` or plain text,
 * which the SDK reports as "400 status code (no body)". Rewrites such bodies into
 * `{ "error": ... }` so the status message carries the provider's explanation.
 */
async function normalizeErrorResponse(response: Response): Promise<Response> {
  const text = await response
    .clone()
    .text()
    .catch(() => '');
  if (text.trim() === '') return response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const candidate: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : parsed;
  const hasError = typeof candidate === 'object' && candidate !== null && 'error' in candidate;
  if (hasError && !Array.isArray(parsed)) return response;
  const body = hasError ? candidate : { error: { message: truncate(text) } };
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function safeUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/** Status and body of a provider error, for the `chat_error` log (no headers, no key). */
export function describeProviderError(error: unknown): { status?: number; body?: string } {
  if (typeof error !== 'object' || error === null) return {};
  const { status, error: body } = error as { status?: unknown; error?: unknown };
  return {
    ...(typeof status === 'number' ? { status } : {}),
    ...(body !== undefined
      ? { body: truncate(typeof body === 'string' ? body : JSON.stringify(body)) }
      : {}),
  };
}
