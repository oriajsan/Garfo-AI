import { type CartService } from '../apps/api/src/cart/cart.service';
import { type ChatEvent } from '@garfo/shared';
import { LlmEventCountingLogger } from './llm-event-counter';
import { RateGate } from './rate-gate';
import { runCase, type EvalDb, type Services } from './run-case';
import { type EvalCase } from './schema';
import { ToolTrace } from './tool-trace';

const evalCase: EvalCase = {
  id: 'simple-dessert-15',
  category: 'simple_filters',
  description: 'x',
  input: ['Quero uma sobremesa de até R$ 15'],
  expect: {
    mustCallTools: ['search_dishes'],
    toolArgs: [{ tool: 'search_dishes', args: { max_price_reais: { lte: 15 } } }],
  },
};

type RunFn = (
  input: { sessionId: string },
  emit: (event: ChatEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

interface Harness {
  services: Services;
  gate: RateGate;
  eventLog: LlmEventCountingLogger;
  trace: ToolTrace;
  rows: Array<{ role: string; content: unknown }>;
}

function harness(run: RunFn, rows: Harness['rows'] = []): Harness {
  const eventLog = new LlmEventCountingLogger();
  const gate = new RateGate(0);
  const trace = new ToolTrace();
  const db: EvalDb = {
    message: { findMany: () => Promise.resolve(rows) },
    dish: { findMany: () => Promise.resolve([]) },
    conversation: { deleteMany: () => Promise.resolve({}) },
    cart: { deleteMany: () => Promise.resolve({}) },
  };
  const services: Services = {
    agent: { run: (input, emit, signal) => run(input, emit, signal) },
    conversations: { resolve: () => Promise.resolve('conv-1') },
    carts: {
      getCart: () =>
        Promise.resolve({ items: [] } as unknown as Awaited<ReturnType<CartService['getCart']>>),
    },
    prisma: db,
  };
  return { services, gate, eventLog, trace, rows };
}

const exec = (h: Harness, options?: { turnTimeoutMs: number }) =>
  runCase(evalCase, h.services, new Map(), h.gate, 'case', h.eventLog, h.trace, options);

/** What the real provider does on a double first-chunk timeout (logs through the observer). */
function logTimeoutsAndFallback(eventLog: LlmEventCountingLogger): void {
  eventLog.warn(JSON.stringify({ event: 'llm_timeout', model: 'a', elapsedMs: 15000, attempt: 1 }));
  eventLog.warn(JSON.stringify({ event: 'llm_timeout', model: 'b', elapsedMs: 15000, attempt: 2 }));
  eventLog.warn(JSON.stringify({ event: 'llm_fallback', from: 'a', to: 'b', result: 'timeout' }));
}

describe('runCase on turns that do not finish', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  // The scenario of simple-dessert-15: search ran, then the second chat call timed out twice.
  const timeoutAfterSearch =
    (h: () => Harness): RunFn =>
    async (input, emit) => {
      const harnessRef = h();
      await harnessRef.gate.wait('embed');
      await harnessRef.gate.wait('chat');
      harnessRef.trace.record(input.sessionId, {
        name: 'search_dishes',
        args: { max_price_reais: 15, category: 'DESSERT' },
      });
      await harnessRef.gate.wait('chat');
      logTimeoutsAndFallback(harnessRef.eventLog);
      emit({ type: 'error', data: { code: 'LLM_TIMEOUT', message: 'demorou' } });
    };

  it('counts timeouts, fallbacks and calls when the turn ends with an error event', async () => {
    const ref: { h?: Harness } = {};
    ref.h = harness(timeoutAfterSearch(() => ref.h as Harness));
    const result = await exec(ref.h);
    expect(result.timeouts).toBe(2);
    expect(result.fallbacks).toBe(1);
    expect(result.chatCalls).toBe(2);
    expect(result.embedCalls).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('keeps the tool trace: mustCall and toolArgs pass, the failure is the timeout', async () => {
    const ref: { h?: Harness } = {};
    ref.h = harness(timeoutAfterSearch(() => ref.h as Harness));
    const result = await exec(ref.h);
    const failedNames = result.checks.filter((c) => !c.passed).map((c) => c.name);
    expect(failedNames).toEqual(['completed']);
    const completed = result.checks.find((c) => c.name === 'completed');
    expect(completed?.detail).toContain('LLM_TIMEOUT');
    expect(completed?.detail).toContain(
      'turno interrompido (LLM_TIMEOUT) depois de iniciar: search_dishes',
    );
  });

  it('counts events logged before an exception', async () => {
    const ref: { h?: Harness } = {};
    ref.h = harness((_input, _emit) => {
      logTimeoutsAndFallback((ref.h as Harness).eventLog);
      return Promise.reject(new Error('boom'));
    });
    const result = await exec(ref.h);
    expect(result.timeouts).toBe(2);
    expect(result.fallbacks).toBe(1);
    expect(result.checks.find((c) => c.name === 'completed')?.detail).toContain(
      'turno interrompido (EXCEPTION) antes de qualquer tool',
    );
  });

  it('counts events when the eval aborts the turn on its own timeout', async () => {
    const ref: { h?: Harness } = {};
    ref.h = harness(
      (input, _emit, signal) =>
        new Promise<void>((resolve) => {
          const h = ref.h as Harness;
          h.trace.record(input.sessionId, { name: 'search_dishes', args: {} });
          logTimeoutsAndFallback(h.eventLog);
          signal.addEventListener('abort', () => resolve());
        }),
    );
    const result = await exec(ref.h, { turnTimeoutMs: 10 });
    expect(result.timeouts).toBe(2);
    expect(result.fallbacks).toBe(1);
    expect(result.checks.find((c) => c.name === 'completed')?.detail).toContain(
      'turno interrompido (EVAL_TIMEOUT) depois de iniciar: search_dishes',
    );
  });

  it('still returns a result when reading the outcome fails', async () => {
    const ref: { h?: Harness } = {};
    ref.h = harness(timeoutAfterSearch(() => ref.h as Harness));
    ref.h.services.prisma.message.findMany = () => Promise.reject(new Error('db down'));
    const result = await exec(ref.h);
    expect(result.timeouts).toBe(2);
    expect(result.checks.find((c) => c.name === 'completed')?.detail).toContain('db down');
  });
});

describe('runCase on completed turns', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('takes tool calls from the trace once, with no duplication from persisted rows', async () => {
    const args = { max_price_reais: 15 };
    const rows = [
      { role: 'USER', content: { text: 'oi' } },
      {
        role: 'ASSISTANT',
        content: {
          text: '',
          toolCalls: [{ id: '1', name: 'search_dishes', argsJson: JSON.stringify(args) }],
        },
      },
      { role: 'TOOL', content: { toolCallId: '1', name: 'search_dishes', result: {} } },
      { role: 'ASSISTANT', content: { text: 'pronto' } },
    ];
    const ref: { h?: Harness } = {};
    ref.h = harness(async (input, emit) => {
      (ref.h as Harness).trace.record(input.sessionId, { name: 'search_dishes', args });
      emit({
        type: 'done',
        data: { usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 5 },
      });
      await Promise.resolve();
    }, rows);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await exec(ref.h);
    expect(result.passed).toBe(true);
    const minCalls = result.checks.filter((c) => c.name.startsWith('mustCall'));
    expect(minCalls).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
