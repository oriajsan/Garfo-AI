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

export class OpenAiLlmProvider implements LlmProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
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
        max_tokens: input.maxTokens,
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
    return [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
