import { Logger } from '@nestjs/common';
import { LlmOverloadedError } from './llm.errors';

/** Waits before retries 1, 2 and 3 (so up to 4 calls in total). */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
const RETRYABLE_STATUS = new Set([429, 503]);

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RetryLogger {
  warn(message: string): void;
}

export interface RetryConfig {
  delaysMs?: readonly number[];
  sleep?: Sleep;
  logger?: RetryLogger;
}

/** Sleep that rejects as soon as the signal aborts. */
export const abortableSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * Runs `operation`, retrying only HTTP 429/503 (SDK retries are off). Meant for calls that fail
 * before any output exists: never wrap something that already emitted chunks.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig & { signal?: AbortSignal; label: string },
): Promise<T> {
  const delays = config.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = config.sleep ?? abortableSleep;
  const logger = config.logger ?? new Logger('LlmRetry');
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const status = httpStatusOf(error);
      if (status === undefined || !RETRYABLE_STATUS.has(status)) throw error;
      const wait = delays[attempt];
      if (wait === undefined) throw new LlmOverloadedError(status, attempt + 1, { cause: error });
      logger.warn(
        JSON.stringify({
          event: 'llm_retry',
          operation: config.label,
          status,
          attempt: attempt + 1,
          maxRetries: delays.length,
          waitMs: wait,
        }),
      );
      await sleep(wait, config.signal);
    }
  }
}
