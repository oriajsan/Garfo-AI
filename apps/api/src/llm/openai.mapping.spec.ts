import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { type LlmStreamChunk } from './llm.types';
import {
  adaptOpenAiStream,
  ToolCallAggregator,
  toOpenAiMessages,
  toOpenAiTools,
} from './openai.mapping';

function chunk(
  delta: ChatCompletionChunk.Choice.Delta,
  usage?: { prompt_tokens: number; completion_tokens: number },
): ChatCompletionChunk {
  return {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: null }],
    ...(usage
      ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }
      : {}),
  };
}

async function* streamOf(chunks: ChatCompletionChunk[]): AsyncGenerator<ChatCompletionChunk> {
  for (const item of chunks) {
    await Promise.resolve();
    yield item;
  }
}

async function collect(chunks: ChatCompletionChunk[]): Promise<LlmStreamChunk[]> {
  const out: LlmStreamChunk[] = [];
  for await (const item of adaptOpenAiStream(streamOf(chunks))) out.push(item);
  return out;
}

describe('toOpenAiMessages', () => {
  it('puts the system prompt first and converts every role', () => {
    const result = toOpenAiMessages('sys', [
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search_dishes', argsJson: '{"query":"x"}' }],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'search_dishes', content: '{"ok":true}' },
      { role: 'assistant', content: 'pronto' },
    ]);
    expect(result).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_dishes', arguments: '{"query":"x"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      { role: 'assistant', content: 'pronto' },
    ]);
  });

  it('keeps text content when an assistant turn has both text and tool calls', () => {
    const [, assistant] = toOpenAiMessages('s', [
      {
        role: 'assistant',
        content: 'vou buscar',
        toolCalls: [{ id: 'a', name: 'n', argsJson: '{}' }],
      },
    ]);
    expect(assistant).toMatchObject({ content: 'vou buscar' });
  });
});

describe('toOpenAiTools', () => {
  it('wraps definitions in the function format', () => {
    expect(
      toOpenAiTools([
        { name: 'view_cart', description: 'Mostra o carrinho', parameters: { type: 'object' } },
      ]),
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'view_cart',
          description: 'Mostra o carrinho',
          parameters: { type: 'object' },
        },
      },
    ]);
  });
});

describe('ToolCallAggregator', () => {
  it('joins argument slices by index and orders by index', () => {
    const aggregator = new ToolCallAggregator();
    aggregator.add([{ index: 1, id: 'b', function: { name: 'view_cart', arguments: '' } }]);
    aggregator.add([
      { index: 0, id: 'a', function: { name: 'search_dishes', arguments: '{"que' } },
    ]);
    aggregator.add([{ index: 0, function: { arguments: 'ry":"x"}' } }]);
    expect(aggregator.flush()).toEqual([
      { type: 'tool_call', id: 'a', name: 'search_dishes', argsJson: '{"query":"x"}' },
      { type: 'tool_call', id: 'b', name: 'view_cart', argsJson: '{}' },
    ]);
  });
});

describe('ToolCallAggregator without index (compatible endpoints)', () => {
  const run = (...batches: Parameters<ToolCallAggregator['add']>[0][]): LlmStreamChunk[] => {
    const aggregator = new ToolCallAggregator();
    batches.forEach((batch) => aggregator.add(batch));
    return aggregator.flush();
  };

  it('builds one call from a single delta', () => {
    expect(
      run([{ id: 'a', function: { name: 'search_dishes', arguments: '{"query":"x"}' } }]),
    ).toEqual([{ type: 'tool_call', id: 'a', name: 'search_dishes', argsJson: '{"query":"x"}' }]);
  });

  it('builds two calls, in order, from two deltas with id and name', () => {
    const out = run(
      [{ id: 'a', function: { name: 'view_cart', arguments: '' } }],
      [{ id: 'b', function: { name: 'clear_cart', arguments: '' } }],
    );
    expect(out.map((c) => (c.type === 'tool_call' ? c.name : ''))).toEqual([
      'view_cart',
      'clear_cart',
    ]);
  });

  it('appends an arguments-only delta to the latest call', () => {
    expect(
      run(
        [{ id: 'a', function: { name: 'search_dishes', arguments: '{"que' } }],
        [{ function: { arguments: 'ry":"x"}' } }],
      ),
    ).toEqual([{ type: 'tool_call', id: 'a', name: 'search_dishes', argsJson: '{"query":"x"}' }]);
  });

  it('starts at call 0 when the first delta has no index, id or name', () => {
    expect(run([{ function: { arguments: '{}' } }])).toHaveLength(1);
  });

  it('gives an empty id a unique fallback', () => {
    const first = run([{ id: '', function: { name: 'view_cart' } }])[0];
    const second = run([{ id: '', function: { name: 'view_cart' } }])[0];
    const ids = [first, second].map((c) => (c?.type === 'tool_call' ? c.id : ''));
    expect(ids[0]).toMatch(/^call_.+/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('keeps interleaved OpenAI indexes 0 and 1 apart', () => {
    expect(
      run(
        [{ index: 0, id: 'a', function: { name: 'search_dishes', arguments: '{"q' } }],
        [{ index: 1, id: 'b', function: { name: 'view_cart', arguments: '' } }],
        [{ index: 0, function: { arguments: '":1}' } }],
      ),
    ).toEqual([
      { type: 'tool_call', id: 'a', name: 'search_dishes', argsJson: '{"q":1}' },
      { type: 'tool_call', id: 'b', name: 'view_cart', argsJson: '{}' },
    ]);
  });
});

describe('adaptOpenAiStream', () => {
  it('treats usage without prompt_tokens as zero', async () => {
    const odd = chunk({ content: 'x' });
    odd.usage = { completion_tokens: 3 } as unknown as NonNullable<typeof odd.usage>;
    expect((await collect([odd])).at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 3 },
    });
  });

  it('emits text deltas, then complete tool calls, then done with usage', async () => {
    const chunks = await collect([
      chunk({ role: 'assistant', content: 'Olá' }),
      chunk({ content: ' mundo' }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'add_to_cart', arguments: '{"dish' },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '_id":"d1"}' } }] }),
      {
        ...chunk({}),
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]);
    expect(chunks).toEqual([
      { type: 'text', delta: 'Olá' },
      { type: 'text', delta: ' mundo' },
      { type: 'tool_call', id: 'call_1', name: 'add_to_cart', argsJson: '{"dish_id":"d1"}' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });

  it('reports zero usage when the stream carries none', async () => {
    expect(await collect([chunk({ content: 'x' })])).toEqual([
      { type: 'text', delta: 'x' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });
});
