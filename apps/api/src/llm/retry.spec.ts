import { type OpenAI } from 'openai';
import { OpenAiEmbeddingProvider, OpenAiLlmProvider } from './openai.provider';
import { LlmOverloadedError } from './llm.errors';
import { abortableSleep, withRetry } from './retry';
import { type LlmChatInput, type LlmStreamChunk } from './llm.types';

const httpError = (status: number): Error =>
  Object.assign(new Error(`${status} error`), { status });
const input: LlmChatInput = { system: 's', messages: [], tools: [], maxTokens: 800 };

function setup(createImpl: jest.Mock) {
  const sleep = jest.fn().mockResolvedValue(undefined);
  const logger = { warn: jest.fn() };
  const client = {
    chat: { completions: { create: createImpl } },
    embeddings: { create: createImpl },
  } as unknown as OpenAI;
  return { sleep, logger, client, retry: { sleep, logger } };
}

async function drain(gen: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
  const out: LlmStreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// eslint-disable-next-line require-yield
async function* emptyStream(): AsyncGenerator<never> {
  await Promise.resolve();
}

describe('chat retry', () => {
  it('retries 503, 503 then succeeds: 3 calls, waits 1s and 2s', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(emptyStream());
    const s = setup(create);
    await drain(new OpenAiLlmProvider(s.client, 'm', false, s.retry).chat(input));
    expect(create).toHaveBeenCalledTimes(3);
    expect(s.sleep.mock.calls.map((c: unknown[]) => c[0])).toEqual([1000, 2000]);
    expect(s.logger.warn).toHaveBeenCalledTimes(2);
    expect((s.logger.warn.mock.calls as string[][])[0]?.[0]).toContain('"status":503');
    expect((s.logger.warn.mock.calls as string[][])[0]?.[0]).toContain('"attempt":1');
  });

  it('gives up on 429 after 4 calls with LlmOverloadedError (waits 1s, 2s, 4s)', async () => {
    const create = jest.fn().mockRejectedValue(httpError(429));
    const s = setup(create);
    const provider = new OpenAiLlmProvider(s.client, 'm', false, s.retry);
    await expect(drain(provider.chat(input))).rejects.toBeInstanceOf(LlmOverloadedError);
    expect(create).toHaveBeenCalledTimes(4);
    expect(s.sleep.mock.calls.map((c: unknown[]) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it('does not retry a 400', async () => {
    const create = jest.fn().mockRejectedValue(httpError(400));
    const s = setup(create);
    const provider = new OpenAiLlmProvider(s.client, 'm', false, s.retry);
    await expect(drain(provider.chat(input))).rejects.toMatchObject({ status: 400 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it('does not retry an error that happens after the first chunk', async () => {
    async function* broken(): AsyncGenerator<unknown> {
      await Promise.resolve();
      yield {
        id: 'c',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'oi' }, finish_reason: null }],
      };
      throw httpError(503);
    }
    const create = jest.fn().mockResolvedValue(broken());
    const s = setup(create);
    const provider = new OpenAiLlmProvider(s.client, 'm', false, s.retry);
    await expect(drain(provider.chat(input))).rejects.toMatchObject({ status: 503 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(s.sleep).not.toHaveBeenCalled();
  });

  it('is interrupted by an abort during the wait', async () => {
    const controller = new AbortController();
    const create = jest.fn().mockRejectedValue(httpError(503));
    const logger = { warn: jest.fn() };
    const provider = new OpenAiLlmProvider(
      { chat: { completions: { create } } } as unknown as OpenAI,
      'm',
      false,
      {
        logger,
        delaysMs: [60_000],
        sleep: abortableSleep,
      },
    );
    const run = drain(provider.chat({ ...input, signal: controller.signal }));
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toThrow('aborted');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('embeddings retry', () => {
  it('retries 429 once then succeeds', async () => {
    const vec = new Array<number>(1536).fill(0.1);
    const create = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: vec }] });
    const s = setup(create);
    await expect(new OpenAiEmbeddingProvider(s.client, 'm', s.retry).embed(['a'])).resolves.toEqual(
      [vec],
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws LlmOverloadedError when exhausted', async () => {
    const create = jest.fn().mockRejectedValue(httpError(503));
    const s = setup(create);
    await expect(
      new OpenAiEmbeddingProvider(s.client, 'm', s.retry).embed(['a']),
    ).rejects.toBeInstanceOf(LlmOverloadedError);
    expect(create).toHaveBeenCalledTimes(4);
  });
});

describe('withRetry', () => {
  it('ignores errors without a status', async () => {
    const op = jest.fn().mockRejectedValue(new Error('network'));
    await expect(withRetry(op, { label: 'x', sleep: jest.fn() })).rejects.toThrow('network');
    expect(op).toHaveBeenCalledTimes(1);
  });
});
