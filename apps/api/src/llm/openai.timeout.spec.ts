import { type OpenAI } from 'openai';
import { type ChatCompletionChunk } from 'openai/resources/chat/completions';
import { LlmTimeoutError } from './llm.errors';
import { type LlmChatInput, type LlmStreamChunk } from './llm.types';
import { OpenAiLlmProvider, type LlmCallOptions } from './openai.provider';

const TIMEOUT = 15_000;
const input = (signal?: AbortSignal): LlmChatInput => ({
  system: 's',
  messages: [{ role: 'user', content: 'oi' }],
  tools: [],
  maxTokens: 800,
  signal,
});

const textChunk = (content: string): ChatCompletionChunk =>
  ({
    id: 'c',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  }) as ChatCompletionChunk;

/** Stream yielding `chunks`, waiting `delaysMs[i]` (fake timers) before chunk i. */
async function* delayedStream(
  chunks: ChatCompletionChunk[],
  delaysMs: number[],
): AsyncGenerator<ChatCompletionChunk> {
  for (const [i, chunk] of chunks.entries()) {
    await new Promise<void>((resolve) => setTimeout(resolve, delaysMs[i] ?? 0));
    yield chunk;
  }
}

/** Resolves a never-ending request that rejects as soon as its signal aborts, like the SDK. */
function hanging(_payload: unknown, options: { signal: AbortSignal }): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(new Error('Request was aborted.'));
    if (options.signal.aborted) abort();
    options.signal.addEventListener('abort', abort, { once: true });
  });
}

function makeProvider(create: jest.Mock, options: LlmCallOptions = {}, compatible = true) {
  const logger = { warn: jest.fn() };
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  const provider = new OpenAiLlmProvider(
    client,
    'main',
    compatible,
    { sleep: jest.fn().mockResolvedValue(undefined), logger },
    { timeoutMs: TIMEOUT, logger, ...options },
  );
  return { provider, logger };
}

const drain = async (gen: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> => {
  const out: LlmStreamChunk[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
};

const events = (logger: { warn: jest.Mock }): Record<string, unknown>[] =>
  logger.warn.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);

const modelOf = (create: jest.Mock, call: number): string =>
  (create.mock.calls[call] as [{ model: string }])[0].model;

describe('chat first-chunk timeout and fallback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('changes nothing when the first chunk arrives in time', async () => {
    const create = jest.fn().mockResolvedValue(delayedStream([textChunk('ola')], [1000]));
    const { provider, logger } = makeProvider(create, { fallbackModel: 'backup' });
    const run = drain(provider.chat(input()));
    await jest.advanceTimersByTimeAsync(1000);
    const out = await run;
    expect(out.filter((c) => c.type === 'text')).toEqual([{ type: 'text', delta: 'ola' }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not time out when later chunks come after the timeout but the first was early', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(delayedStream([textChunk('a'), textChunk('b')], [1000, TIMEOUT + 5000]));
    const { provider, logger } = makeProvider(create, { fallbackModel: 'backup' });
    const run = drain(provider.chat(input()));
    await jest.advanceTimersByTimeAsync(1000 + TIMEOUT + 5000);
    const out = await run;
    expect(out.filter((c) => c.type === 'text')).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('times out on the main model and succeeds on the fallback, using its model name', async () => {
    const create = jest
      .fn()
      .mockImplementationOnce(hanging)
      .mockResolvedValueOnce(delayedStream([textChunk('ok')], [10]));
    const { provider, logger } = makeProvider(create, { fallbackModel: 'backup' });
    const run = drain(provider.chat(input()));
    await jest.advanceTimersByTimeAsync(TIMEOUT + 10);
    const out = await run;
    expect(out.filter((c) => c.type === 'text')).toEqual([{ type: 'text', delta: 'ok' }]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(modelOf(create, 0)).toBe('main');
    expect(modelOf(create, 1)).toBe('backup');
    expect(events(logger)).toEqual([
      { event: 'llm_timeout', model: 'main', elapsedMs: TIMEOUT, attempt: 1 },
      { event: 'llm_fallback', from: 'main', to: 'backup', result: 'ok' },
    ]);
  });

  it('raises LlmTimeoutError when the fallback times out too', async () => {
    const create = jest.fn().mockImplementation(hanging);
    const { provider, logger } = makeProvider(create, { fallbackModel: 'backup' });
    const run = drain(provider.chat(input()));
    const assertion = expect(run).rejects.toBeInstanceOf(LlmTimeoutError);
    await jest.advanceTimersByTimeAsync(TIMEOUT * 2);
    await assertion;
    expect(create).toHaveBeenCalledTimes(2);
    expect(events(logger).map((e) => e.event)).toEqual([
      'llm_timeout',
      'llm_timeout',
      'llm_fallback',
    ]);
    expect(events(logger)[2]).toMatchObject({ result: 'timeout' });
  });

  it('raises LlmTimeoutError straight away without a fallback model', async () => {
    const create = jest.fn().mockImplementation(hanging);
    const { provider, logger } = makeProvider(create);
    const run = drain(provider.chat(input()));
    const assertion = expect(run).rejects.toBeInstanceOf(LlmTimeoutError);
    await jest.advanceTimersByTimeAsync(TIMEOUT);
    await assertion;
    expect(create).toHaveBeenCalledTimes(1);
    expect(events(logger).map((e) => e.event)).toEqual(['llm_timeout']);
  });

  it('does not fall back when the user aborts while waiting', async () => {
    const create = jest.fn().mockImplementation(hanging);
    const { provider, logger } = makeProvider(create, { fallbackModel: 'backup' });
    const user = new AbortController();
    const run = drain(provider.chat(input(user.signal)));
    const assertion = expect(run).rejects.not.toBeInstanceOf(LlmTimeoutError);
    await jest.advanceTimersByTimeAsync(2000);
    user.abort();
    await assertion;
    await jest.advanceTimersByTimeAsync(TIMEOUT * 2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('counts the timeout per call: 429/503 backoff does not eat into it', async () => {
    const overloaded = Object.assign(new Error('503'), { status: 503 });
    const create = jest
      .fn()
      .mockRejectedValueOnce(overloaded)
      .mockResolvedValueOnce(delayedStream([textChunk('ok')], [TIMEOUT - 1]));
    const { provider } = makeProvider(create, { fallbackModel: 'backup' });
    const run = drain(provider.chat(input()));
    await jest.advanceTimersByTimeAsync(TIMEOUT);
    await run;
    expect(create).toHaveBeenCalledTimes(2);
    expect(modelOf(create, 1)).toBe('main');
  });
});

describe('chat reasoning_effort', () => {
  const emptyStream = (): AsyncGenerator<never> => (async function* () {})();
  const sentPayload = async (
    compatible: boolean,
    options: LlmCallOptions,
  ): Promise<Record<string, unknown>> => {
    const create = jest.fn().mockResolvedValue(emptyStream());
    const { provider } = makeProvider(create, options, compatible);
    await drain(provider.chat(input()));
    return (create.mock.calls[0] as [Record<string, unknown>])[0];
  };

  it('keeps the OpenAI payload identical even with every option set', async () => {
    const payload = await sentPayload(false, {
      reasoningEffort: 'minimal',
      fallbackModel: 'backup',
    });
    expect(payload).toEqual({
      model: 'main',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'oi' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 800,
    });
    expect(payload).not.toHaveProperty('reasoning_effort');
  });

  it('sends reasoning_effort only with a compatible endpoint', async () => {
    const payload = await sentPayload(true, { reasoningEffort: 'minimal' });
    expect(payload).toMatchObject({ reasoning_effort: 'minimal', max_tokens: 4096 });
    expect(await sentPayload(true, {})).not.toHaveProperty('reasoning_effort');
  });
});
