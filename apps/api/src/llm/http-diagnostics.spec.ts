import OpenAI from 'openai';
import {
  createDiagnosticFetch,
  describeProviderError,
  MAX_LOGGED_BODY_CHARS,
} from './http-diagnostics';

const respond = (status: number, body: string): jest.Mock =>
  jest.fn().mockResolvedValue(new Response(body, { status }));

describe('createDiagnosticFetch', () => {
  it('logs status and body of a 400 and returns the response untouched', async () => {
    const logger = { warn: jest.fn() };
    const body = JSON.stringify({ error: { message: 'missing thought_signature' } });
    const f = createDiagnosticFetch(logger, respond(400, body));
    const res = await f('https://x.test/v1/chat/completions?key=SECRET', {
      headers: { Authorization: 'Bearer SECRET' },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(body);
    const logged = String((logger.warn.mock.calls as string[][])[0]?.[0]);
    expect(logged).toContain('"status":400');
    expect(logged).toContain('missing thought_signature');
    expect(logged).not.toContain('SECRET');
  });

  it('truncates large bodies and stays silent on success', async () => {
    const logger = { warn: jest.fn() };
    await createDiagnosticFetch(logger, respond(200, 'ok'))('https://x.test/');
    expect(logger.warn).not.toHaveBeenCalled();
    await createDiagnosticFetch(logger, respond(500, 'x'.repeat(10_000)))('https://x.test/');
    expect(String((logger.warn.mock.calls as string[][])[0]?.[0]).length).toBeLessThan(
      MAX_LOGGED_BODY_CHARS + 300,
    );
  });

  it('works end to end with the OpenAI client (status and body reach the log)', async () => {
    const logger = { warn: jest.fn() };
    const client = new OpenAI({
      apiKey: 'sk-secret',
      baseURL: 'https://x.test/v1',
      maxRetries: 0,
      fetch: createDiagnosticFetch(
        logger,
        respond(400, JSON.stringify([{ error: { message: 'bad request detail' } }])),
      ),
    });
    const error: unknown = await client.chat.completions
      .create({ model: 'm', messages: [] })
      .catch((e: unknown) => e);
    expect(String((logger.warn.mock.calls as string[][])[0]?.[0])).toContain('bad request detail');
    expect(describeProviderError(error)).toMatchObject({ status: 400 });
    expect(describeProviderError(error).body).toContain('bad request detail');
    expect(JSON.stringify(logger.warn.mock.calls as string[][])).not.toContain('sk-secret');
  });
});

describe('error normalisation', () => {
  it('turns text and array bodies into { error } so the SDK message has the detail', async () => {
    const client = (body: string): OpenAI =>
      new OpenAI({
        apiKey: 'k',
        baseURL: 'https://x.test/v1',
        maxRetries: 0,
        fetch: createDiagnosticFetch({ warn: jest.fn() }, respond(503, body)),
      });
    const text: unknown = await client('upstream busy')
      .chat.completions.create({ model: 'm', messages: [] })
      .catch((e: unknown) => e);
    expect((text as Error).message).toContain('upstream busy');
    expect(describeProviderError(text).status).toBe(503);
  });
});
