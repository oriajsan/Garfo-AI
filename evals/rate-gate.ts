import type {
  EmbeddingProvider,
  LlmChatInput,
  LlmProvider,
  LlmStreamChunk,
} from '../apps/api/src/llm/llm.types';

/**
 * Pacing for the eval only (production is untouched). The free Gemini tier limits requests
 * per minute, so the eval keeps at least `delayMs` between the START of consecutive provider
 * calls (chat and embeddings share one gate). The first call never waits.
 */
export const DEFAULT_EVAL_DELAY_MS = 2000;

/** Effective pause: `EVAL_DELAY_MS` only matters with the real provider; `fake` is always 0. */
export function parseEvalDelayMs(raw: string | undefined, provider: 'openai' | 'fake'): number {
  if (raw === undefined || raw.trim() === '')
    return provider === 'fake' ? 0 : DEFAULT_EVAL_DELAY_MS;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`EVAL_DELAY_MS inválido: "${raw}". Use um inteiro >= 0 (milissegundos).`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`EVAL_DELAY_MS inválido: "${raw}". Use um inteiro >= 0 (milissegundos).`);
  }
  return provider === 'fake' ? 0 : value;
}

export interface RateGateClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: RateGateClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type CallKind = 'chat' | 'embed';

/**
 * `latencyMs` of a reply minus the time the gate made it wait (pacing is an eval artifact,
 * not agent latency). Never negative.
 */
export function discountWait(latencyMs: number, waitedMs: number): number {
  return Math.max(0, latencyMs - waitedMs);
}

export class RateGate {
  private lastStart: number | undefined;
  /** Total time actually slept by the gate; snapshot it around a turn to get that turn's wait. */
  private waited = 0;
  private chat = 0;
  private embed = 0;
  /** Serializes callers so concurrent ones still get spaced slots. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly delayMs: number,
    private readonly clock: RateGateClock = realClock,
  ) {}

  /** Cumulative milliseconds spent waiting for a slot. */
  get waitedMs(): number {
    return this.waited;
  }

  /** Cumulative provider calls seen by the gate, per kind. */
  get calls(): { chat: number; embed: number } {
    return { chat: this.chat, embed: this.embed };
  }

  /** Resolves when the caller may start its provider call. */
  wait(kind: CallKind = 'chat'): Promise<void> {
    if (kind === 'chat') this.chat += 1;
    else this.embed += 1;
    const slot = this.queue.then(async () => {
      if (this.lastStart !== undefined) {
        const remaining = this.lastStart + this.delayMs - this.clock.now();
        if (remaining > 0) {
          await this.clock.sleep(remaining);
          this.waited += remaining;
        }
      }
      this.lastStart = this.clock.now();
    });
    this.queue = slot.catch(() => undefined);
    return slot;
  }
}

export class PacedLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly gate: RateGate,
  ) {}

  async *chat(input: LlmChatInput): AsyncIterable<LlmStreamChunk> {
    await this.gate.wait('chat');
    yield* this.inner.chat(input);
  }
}

export class PacedEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly gate: RateGate,
  ) {}

  get dimensions(): number {
    return this.inner.dimensions;
  }
  get modelId(): string {
    return this.inner.modelId;
  }
  get minRelevanceScore(): number {
    return this.inner.minRelevanceScore;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.gate.wait('embed');
    return this.inner.embed(texts);
  }
}
