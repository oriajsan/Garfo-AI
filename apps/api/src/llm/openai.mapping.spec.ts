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

describe('Gemini thought signatures (extra_content)', () => {
  const signature = { google: { thought_signature: 'sig-abc==' } };

  it('captures extra_content from the stream and sends it back in the next request', async () => {
    const withExtra = {
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'search_dishes', arguments: '{"q":' },
          extra_content: signature,
        },
      ],
    } as unknown as ChatCompletionChunk.Choice.Delta;
    const out = await collect([
      chunk(withExtra),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }),
      chunk({
        tool_calls: [
          { id: 'call_2', function: { name: 'add_to_cart', arguments: '{}' } },
        ] as unknown as ChatCompletionChunk.Choice.Delta.ToolCall[],
      }),
    ]);
    const calls = out.filter((c) => c.type === 'tool_call');
    expect(calls[0]).toMatchObject({
      id: 'call_1',
      argsJson: '{"q":"x"}',
      extraContent: signature,
    });
    expect(calls[1]).not.toHaveProperty('extraContent');

    const [first] = calls;
    if (first?.type !== 'tool_call') throw new Error('expected a tool call');
    const messages = toOpenAiMessages('sys', [
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: first.id,
            name: first.name,
            argsJson: first.argsJson,
            extraContent: first.extraContent,
          },
          { id: 'call_2', name: 'add_to_cart', argsJson: '{}' },
        ],
      },
    ]);
    expect(messages[2]).toMatchObject({
      tool_calls: [{ id: 'call_1', extra_content: signature }, { id: 'call_2' }],
    });
    const second = (messages[2] as { tool_calls: object[] }).tool_calls[1];
    expect(second).not.toHaveProperty('extra_content');
  });

  it('keeps the OpenAI payload byte for byte when there is no extra_content', () => {
    const messages = toOpenAiMessages('sys', [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'search_dishes', argsJson: '{"a":1}' }],
      },
    ]);
    expect(JSON.stringify(messages[1])).toBe(
      '{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"search_dishes","arguments":"{\\"a\\":1}"}}]}',
    );
  });

  const asDelta = (value: unknown): ChatCompletionChunk.Choice.Delta =>
    value as ChatCompletionChunk.Choice.Delta;
  const toolCalls = (chunks: LlmStreamChunk[]) => chunks.filter((c) => c.type === 'tool_call');

  it('captures extra_content that only arrives in a later delta of the same call', async () => {
    const out = await collect([
      chunk(
        asDelta({
          tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_dishes', arguments: '{' } }],
        }),
      ),
      chunk(
        asDelta({
          tool_calls: [{ index: 0, function: { arguments: '}' }, extra_content: signature }],
        }),
      ),
    ]);
    expect(toolCalls(out)).toEqual([
      expect.objectContaining({ id: 'c1', argsJson: '{}', extraContent: signature }),
    ]);
  });

  it('keeps the signature on the second parallel call only', async () => {
    const out = await collect([
      chunk(
        asDelta({
          tool_calls: [
            { index: 0, id: 'c1', function: { name: 'view_cart', arguments: '{}' } },
            {
              index: 1,
              id: 'c2',
              function: { name: 'search_dishes', arguments: '{}' },
              extra_content: signature,
            },
          ],
        }),
      ),
    ]);
    const [a, b] = toolCalls(out);
    expect(a).not.toHaveProperty('extraContent');
    expect(b).toMatchObject({ id: 'c2', extraContent: signature });
  });

  it('attaches extra_content from a continuation delta without index', async () => {
    const out = await collect([
      chunk(
        asDelta({
          tool_calls: [{ id: 'c1', function: { name: 'search_dishes', arguments: '{"q":' } }],
        }),
      ),
      chunk(asDelta({ tool_calls: [{ function: { arguments: '1}' }, extra_content: signature }] })),
    ]);
    expect(toolCalls(out)).toEqual([
      expect.objectContaining({ id: 'c1', argsJson: '{"q":1}', extraContent: signature }),
    ]);
  });
});
