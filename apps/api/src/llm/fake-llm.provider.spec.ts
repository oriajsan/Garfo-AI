import { DEMO_MODE_TEXT, FakeLlmProvider } from './fake-llm.provider';
import { type LlmChatInput, type LlmStreamChunk } from './llm.types';

const input = (overrides: Partial<LlmChatInput> = {}): LlmChatInput => ({
  system: 'sys',
  messages: [{ role: 'user', content: 'oi' }],
  tools: [],
  maxTokens: 100,
  ...overrides,
});

async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
  const out: LlmStreamChunk[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('FakeLlmProvider', () => {
  it('plays one scripted turn per call, streaming text in small pieces', async () => {
    const provider = new FakeLlmProvider([
      { toolCalls: [{ id: 't1', name: 'search_dishes', args: { query: 'pizza' } }] },
      { text: 'Aqui está a sua recomendação de hoje.' },
    ]);

    const first = await collect(provider.chat(input()));
    expect(first[0]).toEqual({
      type: 'tool_call',
      id: 't1',
      name: 'search_dishes',
      argsJson: '{"query":"pizza"}',
    });
    expect(first.at(-1)?.type).toBe('done');

    const second = await collect(provider.chat(input()));
    const texts = second.filter((c) => c.type === 'text');
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.map((c) => (c.type === 'text' ? c.delta : '')).join('')).toBe(
      'Aqui está a sua recomendação de hoje.',
    );
  });

  it('generates ids for tool calls without one', async () => {
    const provider = new FakeLlmProvider([{ toolCalls: [{ name: 'view_cart', args: {} }] }]);
    const [call] = await collect(provider.chat(input()));
    expect(call).toMatchObject({
      type: 'tool_call',
      name: 'view_cart',
      id: expect.any(String) as string,
    });
  });

  it('falls back to the demo-mode text without a script or after it ends', async () => {
    const provider = new FakeLlmProvider();
    const text = (await collect(provider.chat(input())))
      .map((c) => (c.type === 'text' ? c.delta : ''))
      .join('');
    expect(text).toBe(DEMO_MODE_TEXT);
  });

  it('reports finish_reason stop, tool_calls or the scripted override', async () => {
    const provider = new FakeLlmProvider([
      { text: 'oi' },
      { toolCalls: [{ name: 'view_cart', args: {} }] },
      { text: 'cortado', finishReason: null },
    ]);
    const done = async (): Promise<unknown> => (await collect(provider.chat(input()))).at(-1);
    expect(await done()).toMatchObject({ finishReason: 'stop', model: 'fake' });
    expect(await done()).toMatchObject({ finishReason: 'tool_calls' });
    expect(await done()).toMatchObject({ finishReason: null });
  });

  it('records every input it receives', async () => {
    const provider = new FakeLlmProvider();
    await collect(provider.chat(input({ system: 'a' })));
    await collect(provider.chat(input({ system: 'b' })));
    expect(provider.calls.map((c) => c.system)).toEqual(['a', 'b']);
  });

  it('stops streaming when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeLlmProvider([{ text: 'texto longo o bastante para vários pedaços' }]);
    expect(await collect(provider.chat(input({ signal: controller.signal })))).toEqual([]);
  });
});
