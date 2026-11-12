/** Thrown when the provider kept answering 429/503 after every retry (code LLM_OVERLOADED). */
export class LlmOverloadedError extends Error {
  constructor(
    readonly status: number,
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super(`LLM provider overloaded (HTTP ${status}) after ${attempts} attempts`, options);
    this.name = 'LlmOverloadedError';
  }
}

/**
 * Thrown when the model's answer came back cut short twice in a row (stream without a valid
 * `finish_reason`, or text visibly incomplete). Reported as LLM_ERROR.
 */
export class LlmTruncatedError extends Error {
  constructor(readonly reason: string) {
    super(`LLM answer was truncated twice (${reason})`);
    this.name = 'LlmTruncatedError';
  }
}

/**
 * Thrown when no first chunk arrived within the per-call timeout, on the main model and on the
 * fallback (if any) (code LLM_TIMEOUT).
 */
export class LlmTimeoutError extends Error {
  constructor(
    readonly model: string,
    readonly timeoutMs: number,
    readonly attempts: number,
  ) {
    super(
      `LLM provider gave no first chunk within ${timeoutMs} ms (model ${model}, ${attempts} attempt(s))`,
    );
    this.name = 'LlmTimeoutError';
  }
}
