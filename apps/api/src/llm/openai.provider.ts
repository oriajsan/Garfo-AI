import { Logger } from '@nestjs/common';
import { type OpenAI } from 'openai';
import {
  type ChatCompletionChunk,
  type ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { LlmTimeoutError } from './llm.errors';
import { VECTOR_DIMENSIONS } from '../config/env';
import {
  type EmbeddingProvider,
  type LlmChatInput,
  type LlmProvider,
  type LlmStreamChunk,
} from './llm.types';
import { withRetry, type RetryConfig } from './retry';
import { adaptOpenAiStream, toOpenAiMessages, toOpenAiTools } from './openai.mapping';

const TEMPERATURE = 0.3;
/**
 * Thinking models behind compatible endpoints (e.g. gemini-2.5-flash) count reasoning tokens
 * inside `max_tokens`; the default cap (800) would truncate answers. Raised only for them.
 */
export const COMPATIBLE_MIN_MAX_TOKENS = 4096;

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
export const DEFAULT_CALL_TIMEOUT_MS = 15_000;

export interface LlmCallOptions {
  /** Sent as `reasoning_effort` only on compatible endpoints (OPENAI_BASE_URL set). */
  reasoningEffort?: ReasoningEffort;
  /** Max wait for the first chunk of one chat call. */
  timeoutMs?: number;
  /** Model retried once after a timeout. Without it a timeout is final. */
  fallbackModel?: string;
  logger?: { warn(message: string): void };
}

/** A stream whose first chunk was already pulled to prove the provider is answering. */
async function* replayFirst<T>(
  first: IteratorResult<T>,
  iterator: AsyncIterator<T>,
  cleanup: () => void,
): AsyncGenerator<T> {
  try {
    if (first.done) return;
    yield first.value;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      yield next.value;
    }
  } finally {
    cleanup();
  }
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly logger: { warn(message: string): void };

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly compatibleEndpoint = false,
    private readonly retry: RetryConfig = {},
    private readonly options: LlmCallOptions = {},
  ) {
    this.logger = options.logger ?? new Logger('LlmTimeout');
  }

  /**
   * How the two protections combine (D6.15). Each model gets, in order:
   *   1. a call that is retried on 429/503 (`withRetry`, backoff 1/2/4 s);
   *   2. each HTTP attempt inside it has its own timeout for the FIRST chunk (open + first token).
   * A timeout is not an HTTP status, so `withRetry` rethrows it at once (no backoff, no retry).
   * Only then the fallback model gets one fresh run of the same thing (own retries, own timeout).
   * If that also times out, or there is no fallback, the error is `LlmTimeoutError`.
   * Once the first chunk is out nothing is ever redone: it would duplicate text.
   */
  async *chat(input: LlmChatInput): AsyncGenerator<LlmStreamChunk> {
    const { stream, model } = await this.openWithFallback(input);
    yield* adaptOpenAiStream(stream, model);
  }

  private async openWithFallback(
    input: LlmChatInput,
  ): Promise<{ stream: AsyncIterable<ChatCompletionChunk>; model: string }> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const fallback = this.options.fallbackModel;
    try {
      return { stream: await this.openModel(this.model, input, timeoutMs, 1), model: this.model };
    } catch (error) {
      if (!(error instanceof LlmTimeoutError) || fallback === undefined) throw error;
      try {
        const stream = await this.openModel(fallback, input, timeoutMs, 2);
        this.logFallback(fallback, 'ok');
        return { stream, model: fallback };
      } catch (fallbackError) {
        this.logFallback(fallback, fallbackError instanceof LlmTimeoutError ? 'timeout' : 'error');
        if (fallbackError instanceof LlmTimeoutError) {
          // Report both attempts as one final timeout.
          throw new LlmTimeoutError(fallback, timeoutMs, 2);
        }
        throw fallbackError;
      }
    }
  }

  private logFallback(to: string, result: 'ok' | 'timeout' | 'error'): void {
    this.logger.warn(JSON.stringify({ event: 'llm_fallback', from: this.model, to, result }));
  }

  /** One model: retry on 429/503, each attempt timed on its first chunk. */
  private openModel(
    model: string,
    input: LlmChatInput,
    timeoutMs: number,
    attempt: number,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    return withRetry(() => this.openTimed(model, input, timeoutMs, attempt), {
      ...this.retry,
      signal: input.signal,
      label: 'chat',
    });
  }

  private async openTimed(
    model: string,
    input: LlmChatInput,
    timeoutMs: number,
    attempt: number,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const controller = new AbortController();
    const onUserAbort = (): void => controller.abort();
    if (input.signal?.aborted) controller.abort();
    input.signal?.addEventListener('abort', onUserAbort, { once: true });
    const detach = (): void => input.signal?.removeEventListener('abort', onUserAbort);
    let timedOut = false;
    let handedOver = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const stream = await this.client.chat.completions.create(this.payload(model, input), {
        signal: controller.signal,
      });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      handedOver = true;
      // The user's abort stays wired to the HTTP request until the stream is consumed.
      return replayFirst(first, iterator, detach);
    } catch (error) {
      // The user's own abort must never look like a timeout (and never trigger the fallback).
      if (timedOut && !input.signal?.aborted) {
        this.logger.warn(
          JSON.stringify({
            event: 'llm_timeout',
            model,
            elapsedMs: Date.now() - startedAt,
            attempt,
          }),
        );
        throw new LlmTimeoutError(model, timeoutMs, attempt);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (!handedOver) detach();
    }
  }

  private payload(model: string, input: LlmChatInput): ChatCompletionCreateParamsStreaming {
    return {
      model,
      messages: toOpenAiMessages(input.system, input.messages),
      ...(input.tools.length > 0 ? { tools: toOpenAiTools(input.tools) } : {}),
      stream: true,
      stream_options: { include_usage: true },
      temperature: TEMPERATURE,
      max_tokens: this.compatibleEndpoint
        ? Math.max(input.maxTokens, COMPATIBLE_MIN_MAX_TOKENS)
        : input.maxTokens,
      // The SDK types only know low/medium/high; compatible endpoints take more (D6.14).
      ...(this.compatibleEndpoint && this.options.reasoningEffort !== undefined
        ? { reasoning_effort: this.options.reasoningEffort as 'low' }
        : {}),
    };
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = VECTOR_DIMENSIONS;
  /** Real cosine scores for related text sit well above this floor (D2.3). */
  readonly minRelevanceScore = 0.25;

  constructor(
    private readonly client: OpenAI,
    readonly modelId: string,
    private readonly retry: RetryConfig = {},
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await withRetry(
      () =>
        this.client.embeddings.create({
          model: this.modelId,
          input: texts,
          dimensions: this.dimensions,
        }),
      { ...this.retry, label: 'embeddings' },
    );
    if (response.data.length !== texts.length) {
      throw new Error(
        `Embedding model "${this.modelId}" returned ${response.data.length} vectors for ${texts.length} inputs. Check LLM_EMBEDDING_MODEL / OPENAI_BASE_URL.`,
      );
    }
    const vectors = [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
    for (const vector of vectors) {
      if (vector.length !== this.dimensions) {
        throw new Error(
          `Embedding model "${this.modelId}" returned a vector with ${vector.length} dimensions, expected ${this.dimensions} (EMBEDDING_DIMENSIONS). Check LLM_EMBEDDING_MODEL / OPENAI_BASE_URL.`,
        );
      }
    }
    return vectors;
  }
}
