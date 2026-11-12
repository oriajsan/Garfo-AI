import { randomUUID } from 'node:crypto';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { sanitizeJsonSchema } from './schema-sanitizer';
import {
  type ChatMessage,
  type JsonValue,
  type LlmStreamChunk,
  type ToolDefinition,
} from './llm.types';

/** Internal `ChatMessage[]` -> OpenAI messages, with the system prompt first. */
export function toOpenAiMessages(
  system: string,
  messages: ChatMessage[],
): ChatCompletionMessageParam[] {
  const converted: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    switch (message.role) {
      case 'user':
        converted.push({ role: 'user', content: message.content });
        break;
      case 'assistant':
        converted.push({
          role: 'assistant',
          // OpenAI expects null (not '') when an assistant turn only has tool calls.
          content: message.content === '' && message.toolCalls?.length ? null : message.content,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call): ChatCompletionMessageToolCall => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.argsJson },
                  // Only present on providers that send it (Gemini); OpenAI payload is unchanged.
                  ...(call.extraContent !== undefined
                    ? ({ extra_content: call.extraContent } as object)
                    : {}),
                })),
              }
            : {}),
        });
        break;
      case 'tool':
        converted.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        });
        break;
    }
  }
  return converted;
}

export function toOpenAiTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeJsonSchema(tool.parameters),
    },
  }));
}

/**
 * Tool calls arrive split across many deltas, identified by `index`: the first delta carries
 * id and name, the following ones carry slices of the JSON arguments. This joins them.
 */
/** `index` is required by the OpenAI types but missing from some compatible endpoints. */
type ToolCallDelta = Omit<ChatCompletionChunk.Choice.Delta.ToolCall, 'index'> & {
  index?: number;
  /** Gemini's thought signature: `{ google: { thought_signature } }`. Opaque to us. */
  extra_content?: JsonValue;
};

export class ToolCallAggregator {
  private readonly calls = new Map<
    number,
    { id: string; name: string; args: string; extra?: JsonValue }
  >();

  add(deltas: ToolCallDelta[]): void {
    for (const delta of deltas) {
      const index = this.resolveIndex(delta);
      const current = this.calls.get(index) ?? { id: '', name: '', args: '' };
      if (delta.id) current.id = delta.id;
      if (delta.function?.name) current.name += delta.function.name;
      if (delta.function?.arguments) current.args += delta.function.arguments;
      if (delta.extra_content !== undefined && delta.extra_content !== null) {
        current.extra = delta.extra_content;
      }
      this.calls.set(index, current);
    }
  }

  /**
   * Some compatible endpoints (Gemini) omit `index`. A delta carrying an id or name then starts a
   * new call; one without continues the latest call.
   */
  private resolveIndex(delta: ToolCallDelta): number {
    if (typeof delta.index === 'number') return delta.index;
    if (delta.id || delta.function?.name || this.calls.size === 0) return this.calls.size;
    return this.calls.size - 1;
  }

  /** Complete calls ordered by index; an empty argument string becomes `{}`. */
  flush(): LlmStreamChunk[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        type: 'tool_call' as const,
        // Unique across loop iterations so ids never collide in the history.
        id: call.id || `call_${randomUUID()}`,
        name: call.name,
        argsJson: call.args === '' ? '{}' : call.args,
        ...(call.extra !== undefined ? { extraContent: call.extra } : {}),
      }));
  }
}

/** Converts an OpenAI chunk stream into the internal chunk protocol. */
export async function* adaptOpenAiStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  model = '',
): AsyncGenerator<LlmStreamChunk> {
  const aggregator = new ToolCallAggregator();
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
    const choice = chunk.choices[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) continue;
    if (delta.content) yield { type: 'text', delta: delta.content };
    if (delta.tool_calls) aggregator.add(delta.tool_calls);
  }

  yield* aggregator.flush();
  yield { type: 'done', usage: { inputTokens, outputTokens }, finishReason, model };
}
