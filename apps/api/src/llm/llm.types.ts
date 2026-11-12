/** Provider-agnostic types (SPEC section 5). The agent only knows these. */

/** Opaque JSON, passed through untouched. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model produced it; validated later with Zod. */
  argsJson: string;
  /**
   * Provider metadata of the call, kept opaque and sent back as received. Gemini 3 puts its
   * thought signature here (`{ google: { thought_signature } }`) and rejects the next request
   * when it is missing.
   */
  extraContent?: JsonValue;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments (generated from Zod in block 3). */
  parameters: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LlmStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; argsJson: string; extraContent?: JsonValue }
  | {
      type: 'done';
      usage: LlmUsage;
      /**
       * Last `finish_reason` any chunk carried (`stop`, `tool_calls`, `length`...), or null when
       * the stream ended without one (cut short).
       */
      finishReason: string | null;
      /** Model that actually answered (the main one or the fallback). */
      model: string;
    };

export interface LlmChatInput {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  chat(input: LlmChatInput): AsyncIterable<LlmStreamChunk>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  /** Identifies the model in `embeddingHash` and in the query cache key (D2.2). */
  readonly modelId: string;
  /** Minimum final search score kept by SearchService (D2.3). */
  readonly minRelevanceScore: number;
}
