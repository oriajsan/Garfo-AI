import { type OpenAI } from 'openai';
import { VECTOR_DIMENSIONS } from '../config/env';
import {
  type EmbeddingProvider,
  type LlmChatInput,
  type LlmProvider,
  type LlmStreamChunk,
} from './llm.types';
import { adaptOpenAiStream, toOpenAiMessages, toOpenAiTools } from './openai.mapping';

const TEMPERATURE = 0.3;
/**
 * Thinking models behind compatible endpoints (e.g. gemini-2.5-flash) count reasoning tokens
 * inside `max_tokens`; the default cap (800) would truncate answers. Raised only for them.
 */
export const COMPATIBLE_MIN_MAX_TOKENS = 4096;

export class OpenAiLlmProvider implements LlmProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly compatibleEndpoint = false,
  ) {}

  async *chat(input: LlmChatInput): AsyncGenerator<LlmStreamChunk> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: toOpenAiMessages(input.system, input.messages),
        ...(input.tools.length > 0 ? { tools: toOpenAiTools(input.tools) } : {}),
        stream: true,
        stream_options: { include_usage: true },
        temperature: TEMPERATURE,
        max_tokens: this.compatibleEndpoint
          ? Math.max(input.maxTokens, COMPATIBLE_MIN_MAX_TOKENS)
          : input.maxTokens,
      },
      { signal: input.signal },
    );
    yield* adaptOpenAiStream(stream);
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = VECTOR_DIMENSIONS;
  /** Real cosine scores for related text sit well above this floor (D2.3). */
  readonly minRelevanceScore = 0.25;

  constructor(
    private readonly client: OpenAI,
    readonly modelId: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.modelId,
      input: texts,
      dimensions: this.dimensions,
    });
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
