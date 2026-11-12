/** Provider-agnostic types (SPEC section 5). The agent only knows these. */

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model produced it; validated later with Zod. */
  argsJson: string;
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
  | { type: 'tool_call'; id: string; name: string; argsJson: string }
  | { type: 'done'; usage: LlmUsage };

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
