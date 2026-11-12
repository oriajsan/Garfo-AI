import { type LlmChatInput, type LlmProvider, type LlmStreamChunk } from './llm.types';

export interface FakeToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/** One scripted model response: text, tool calls, or both. */
export interface FakeTurn {
  text?: string;
  toolCalls?: FakeToolCall[];
}

export const DEMO_MODE_TEXT =
  'Estou em modo demonstração, sem um modelo de IA conectado. Configure OPENAI_API_KEY para conversar de verdade.';

const TEXT_CHUNK_SIZE = 12;

/** Decides the next turn when there is no script left (the key-less demo, see demo-policy.ts). */
export type FakeFallback = (input: LlmChatInput) => FakeTurn;

/**
 * Scripted provider for tests and key-less runs. Each `chat` call plays the next turn of the
 * script, streaming text in small pieces. Every input received is recorded in `calls`.
 * Without a script (or once it runs out) it asks the `fallback`: by default a fixed demo-mode
 * text; at runtime the factory injects the heuristic demo policy.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly calls: LlmChatInput[] = [];
  private cursor = 0;

  constructor(
    private readonly script: FakeTurn[] = [],
    private readonly fallback: FakeFallback = () => ({ text: DEMO_MODE_TEXT }),
  ) {}

  async *chat(input: LlmChatInput): AsyncIterable<LlmStreamChunk> {
    this.calls.push(input);
    const turn = this.script[this.cursor++] ?? this.fallback(input);
    let outputChars = 0;

    for (const piece of splitText(turn.text ?? '')) {
      await Promise.resolve(); // yield to the event loop, like a real network stream
      if (input.signal?.aborted) return;
      outputChars += piece.length;
      yield { type: 'text', delta: piece };
    }

    for (const [index, call] of (turn.toolCalls ?? []).entries()) {
      outputChars += call.name.length;
      yield {
        type: 'tool_call',
        id: call.id ?? `call_${this.cursor}_${index}`,
        name: call.name,
        argsJson: JSON.stringify(call.args),
      };
    }

    yield {
      type: 'done',
      usage: {
        inputTokens: Math.ceil(input.messages.length + input.system.length / 4),
        outputTokens: Math.ceil(outputChars / 4),
      },
    };
  }
}

function splitText(text: string): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += TEXT_CHUNK_SIZE) {
    pieces.push(text.slice(i, i + TEXT_CHUNK_SIZE));
  }
  return pieces;
}
