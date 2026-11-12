import { ToolTrace, TracingToolRegistry } from './tool-trace';

describe('TracingToolRegistry', () => {
  beforeEach(() => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  const build = () => {
    const trace = new ToolTrace();
    const cart = { getCart: jest.fn().mockResolvedValue({ items: [], totalCents: 0 }) };
    const registry = new TracingToolRegistry({} as never, cart as never, trace);
    return { trace, registry };
  };

  it('records name and parsed args of each execution, per session, in order', async () => {
    const { trace, registry } = build();
    await registry.execute('view_cart', '{}', { sessionId: 's1' });
    await registry.execute('get_dish', '{"dish_id":"x"}', { sessionId: 's2' });
    await registry.execute('view_cart', '', { sessionId: 's1' });
    expect(trace.calls('s1').map((c) => c.name)).toEqual(['view_cart', 'view_cart']);
    expect(trace.calls('s2')).toEqual([{ name: 'get_dish', args: { dish_id: 'x' } }]);
  });

  it('records invalid JSON as undefined args and unknown tools, like the persisted rows do', async () => {
    const { trace, registry } = build();
    const execution = await registry.execute('nope', '{bad', { sessionId: 's' });
    expect(execution.ok).toBe(false);
    expect(trace.calls('s')).toEqual([{ name: 'nope', args: undefined }]);
  });

  it('records a call even when the execution never finishes', () => {
    const { trace, registry } = build();
    void registry.execute('view_cart', '{}', { sessionId: 's' });
    expect(trace.size('s')).toBe(1);
  });
});
