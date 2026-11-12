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
