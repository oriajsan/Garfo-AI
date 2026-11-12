import { ConsoleLogger } from '@nestjs/common';

/**
 * Non-intrusive observer for the `llm_retry` warnings that `withRetry` already logs (production
 * code is untouched). Installed with `Logger.overrideLogger`; everything is still forwarded to
 * the normal console logger. Snapshot `count`/`waitMs` around a case to get its retries.
 */
export class RetryCountingLogger extends ConsoleLogger {
  private retries = 0;
  private waited = 0;

  get count(): number {
    return this.retries;
  }

  /** Backoff time the retries made the agent wait, in ms. */
  get waitMs(): number {
    return this.waited;
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    this.observe(message);
    super.warn(message, ...rest);
  }

  private observe(message: unknown): void {
    if (typeof message !== 'string' || !message.includes('"llm_retry"')) return;
    try {
      const parsed = JSON.parse(message) as { event?: unknown; waitMs?: unknown };
      if (parsed.event !== 'llm_retry') return;
      this.retries += 1;
      if (typeof parsed.waitMs === 'number') this.waited += parsed.waitMs;
    } catch {
      // Not our JSON line.
    }
  }
}
