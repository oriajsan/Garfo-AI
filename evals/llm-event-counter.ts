import { ConsoleLogger } from '@nestjs/common';

/**
 * Non-intrusive observer for the structured warnings the production code already logs
 * (`llm_retry`, `llm_timeout`, `llm_fallback`, `llm_truncated`); production is untouched. Installed with the
 * testing module builder's `setLogger` (`compile()` replaces a plain `Logger.overrideLogger`); warnings and errors are still forwarded to the console.
 * Snapshot the counters around a case to get its numbers.
 */
export class LlmEventCountingLogger extends ConsoleLogger {
  private retries = 0;
  private waited = 0;
  private timeoutCount = 0;
  private fallbackCount = 0;
  private truncatedCount = 0;

  /** 429/503 retries. */
  get count(): number {
    return this.retries;
  }

  /** Backoff time the retries made the agent wait, in ms. */
  get waitMs(): number {
    return this.waited;
  }

  /** First-chunk timeouts (main model and fallback both count). */
  get timeouts(): number {
    return this.timeoutCount;
  }

  /** Times the fallback model was used after a timeout. */
  get fallbacks(): number {
    return this.fallbackCount;
  }

  /** Model turns that came back cut short (both attempts count). */
  get truncations(): number {
    return this.truncatedCount;
  }

  // Same quiet level as Nest's TestingLogger (what `compile()` would otherwise install):
  // only warnings and errors reach the console.
  override log(): void {}
  override debug(): void {}
  override verbose(): void {}

  override warn(message: unknown, ...rest: unknown[]): void {
    this.observe(message);
    super.warn(message, ...rest);
  }

  private observe(message: unknown): void {
    if (typeof message !== 'string' || !message.includes('"event"')) return;
    try {
      const parsed = JSON.parse(message) as { event?: unknown; waitMs?: unknown };
      switch (parsed.event) {
        case 'llm_retry':
          this.retries += 1;
          if (typeof parsed.waitMs === 'number') this.waited += parsed.waitMs;
          break;
        case 'llm_timeout':
          this.timeoutCount += 1;
          break;
        case 'llm_fallback':
          this.fallbackCount += 1;
          break;
        case 'llm_truncated':
          this.truncatedCount += 1;
          break;
      }
    } catch {
      // Not our JSON line.
    }
  }
}
