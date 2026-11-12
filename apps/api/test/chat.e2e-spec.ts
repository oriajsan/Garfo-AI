import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { startOfDaySaoPaulo } from '../src/common/time';
import { ConfigService } from '../src/config/config.service';
import { validateEnv } from '../src/config/env';
import { FakeLlmProvider, type FakeTurn } from '../src/llm/fake-llm.provider';
import { LLM_PROVIDER } from '../src/llm/llm.tokens';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadFixtures, type Fixtures } from '../src/testing/db';

// See app.e2e-spec.ts: Scalar is ESM-only and cannot load inside Jest's CommonJS sandbox.
jest.mock('@scalar/nestjs-api-reference', () => ({
  apiReference: () => (_req: unknown, res: { end: () => void }) => res.end(),
}));

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}
interface ErrorBody {
  error: { code: string; message: string };
}
interface MessagesBody {
  conversationId: string;
  messages: Array<{ role: string; text: string; dishCards: Array<{ id: string }> }>;
}

/** Collects the whole text/event-stream body (superagent does not buffer it by itself). */
function collectText(
  res: NodeJS.ReadableStream,
  callback: (error: Error | null, body: string) => void,
): void {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (data += chunk));
  res.on('end', () => callback(null, data));
}

function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('event: '))
    .map((frame) => {
      const [eventLine = '', dataLine = ''] = frame.split('\n');
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
      };
    });
}

const types = (events: SseEvent[]): string[] =>
  events.map((e) => e.event).filter((t, i, all) => !(t === 'token' && all[i - 1] === 'token'));

describe('POST /chat (e2e)', () => {
  const apps: NestExpressApplication[] = [];
  const sessions: string[] = [];
  let prisma: PrismaService;
  let fx: Fixtures;

  const session = (): string => {
    const id = randomUUID();
    sessions.push(id);
    return id;
  };

  async function createApp(
    script: FakeTurn[],
    config: { maxDaily?: number } = {},
  ): Promise<{ app: NestExpressApplication; provider: FakeLlmProvider }> {
    const provider = new FakeLlmProvider(script);
    const env = {
      ...validateEnv(process.env),
      MAX_DAILY_CHAT_REQUESTS: config.maxDaily ?? 100_000,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(Object.freeze(env)))
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    apps.push(app);
    return { app, provider };
  }

  const chat = (
    app: NestExpressApplication,
    sid: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('X-Session-Id', sid)
      .set(headers)
      .buffer(true)
      .parse((res, callback) => collectText(res as unknown as NodeJS.ReadableStream, callback))
      .send(body as object);

  const sseOf = (res: { body: unknown }): SseEvent[] => parseSse(res.body as string);

  beforeAll(async () => {
    const probe = await createApp([]);
    prisma = probe.app.get(PrismaService);
    fx = await loadFixtures(prisma);
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma.cart.deleteMany({ where: { sessionId: { in: sessions } } });
    for (const app of apps) await app.close();
  });

  it('streams meta, token and done in order with the SSE headers', async () => {
    const { app } = await createApp([{ text: 'Olá! Eu ajudo com pedidos de comida.' }]);
    const res = await chat(app, session(), { message: 'oi' }).expect(200);

    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');
    const events = sseOf(res);
    expect(types(events)).toEqual(['meta', 'token', 'done']);
    expect(
      events
        .filter((e) => e.event === 'token')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Olá! Eu ajudo com pedidos de comida.');
    expect(events.at(-1)?.data).toMatchObject({
      usage: { inputTokens: expect.any(Number) as number },
    });
  });

  it('uses the stored history on the second message of the same conversation', async () => {
    const { app, provider } = await createApp([{ text: 'primeira' }, { text: 'segunda' }]);
    const sid = session();
    const first = sseOf(await chat(app, sid, { message: 'um' }));
    const conversationId = first[0]?.data.conversationId as string;

    const second = sseOf(await chat(app, sid, { message: 'dois', conversationId }));
    expect(second[0]?.data.conversationId).toBe(conversationId);
    expect(provider.calls[1]?.messages).toEqual([
      { role: 'user', content: 'um' },
      { role: 'assistant', content: 'primeira' },
      { role: 'user', content: 'dois' },
    ]);

    const messages = await request(app.getHttpServer())
      .get(`/api/v1/chat/${conversationId}/messages`)
      .set('X-Session-Id', sid)
      .expect(200);
    expect((messages.body as MessagesBody).messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'um'],
      ['assistant', 'primeira'],
      ['user', 'dois'],
      ['assistant', 'segunda'],
    ]);
  });

  it('cites a dish: cards are emitted, markers never reach the client, GET rebuilds the cards', async () => {
    const dish = fx.dishA;
    const { app } = await createApp([
      { toolCalls: [{ name: 'get_dish', args: { dish_id: dish.id } }] },
      { text: `Que tal o ${dish.name} [[dish:${dish.id}]] do ${dish.restaurant.name}?` },
    ]);
    const sid = session();
    const res = await chat(app, sid, { message: 'me indica algo' }).expect(200);
    const events = sseOf(res);

    expect(types(events)).toEqual([
      'meta',
      'tool_start',
      'tool_end',
      'token',
      'dish_cards',
      'done',
    ]);
    expect(res.body as string).not.toContain('[[dish:');
    const cards = events.find((e) => e.event === 'dish_cards')?.data.dishes as Array<{
      id: string;
    }>;
    expect(cards.map((c) => c.id)).toEqual([dish.id]);

    const conversationId = events[0]?.data.conversationId as string;
    const messages = await request(app.getHttpServer())
      .get(`/api/v1/chat/${conversationId}/messages`)
      .set('X-Session-Id', sid)
      .expect(200);
    const body = messages.body as MessagesBody;
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.text).toBe(`Que tal o ${dish.name} do ${dish.restaurant.name}?`);
    expect(body.messages[1]?.dishCards.map((c) => c.id)).toEqual([dish.id]);
  });

  it('adds to the cart through the agent and emits cart_updated', async () => {
    const { app } = await createApp([
      { toolCalls: [{ name: 'add_to_cart', args: { dish_id: fx.dishA.id, quantity: 2 } }] },
      { text: 'Pronto, adicionei ao carrinho.' },
    ]);
    const sid = session();
    const events = sseOf(await chat(app, sid, { message: 'adiciona 2' }).expect(200));
    expect(types(events)).toEqual([
      'meta',
      'tool_start',
      'tool_end',
      'cart_updated',
      'token',
      'done',
    ]);

    const cart = await request(app.getHttpServer()).get('/api/v1/cart').set('X-Session-Id', sid);
    expect(cart.body).toMatchObject({
      itemCount: 2,
      items: [{ dishId: fx.dishA.id, quantity: 2 }],
    });
  });

  it('creates a new conversation when the id is unknown or belongs to another session', async () => {
    const { app } = await createApp([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    const owner = session();
    const original = sseOf(await chat(app, owner, { message: 'oi' }))[0]?.data
      .conversationId as string;

    const unknown = sseOf(await chat(app, owner, { message: 'oi', conversationId: randomUUID() }));
    expect(unknown[0]?.data.conversationId).not.toBe(original);

    const stolen = sseOf(await chat(app, session(), { message: 'oi', conversationId: original }));
    expect(stolen[0]?.data.conversationId).not.toBe(original);
  });

  it('GET /chat/:id/messages is 404 for another session and 400 for a bad id', async () => {
    const { app } = await createApp([{ text: 'a' }]);
    const owner = session();
    const id = sseOf(await chat(app, owner, { message: 'oi' }))[0]?.data.conversationId as string;

    const other = await request(app.getHttpServer())
      .get(`/api/v1/chat/${id}/messages`)
      .set('X-Session-Id', session())
      .expect(404);
    expect((other.body as ErrorBody).error.code).toBe('CONVERSATION_NOT_FOUND');

    await request(app.getHttpServer())
      .get('/api/v1/chat/not-a-uuid/messages')
      .set('X-Session-Id', owner)
      .expect(400);
  });

  it.each([
    ['empty message', { message: '' }],
    ['blank message', { message: '    ' }],
    ['message above 500 characters', { message: 'x'.repeat(501) }],
    ['missing message', {}],
    ['invalid conversationId', { message: 'oi', conversationId: 'abc' }],
  ])('answers 400 JSON before opening the stream: %s', async (_name, body) => {
    const { app, provider } = await createApp([{ text: 'nunca' }]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('X-Session-Id', session())
      .send(body)
      .expect(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    expect(provider.calls).toHaveLength(0);
  });

  it('requires X-Session-Id', async () => {
    const { app } = await createApp([]);
    await request(app.getHttpServer()).post('/api/v1/chat').send({ message: 'oi' }).expect(400);
  });

  it('limits to 15 requests per minute per IP (429 RATE_LIMITED, JSON)', async () => {
    const { app } = await createApp(Array.from({ length: 16 }, () => ({ text: 'ok' })));
    const ip = { 'X-Forwarded-For': '203.0.113.10' };
    for (let i = 0; i < 15; i += 1) await chat(app, session(), { message: 'oi' }, ip).expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('X-Session-Id', session())
      .set(ip)
      .send({ message: 'oi' })
      .expect(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect((res.body as ErrorBody).error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after-ip']).toBeDefined();

    // Another IP is unaffected.
    await chat(app, session(), { message: 'oi' }, { 'X-Forwarded-For': '203.0.113.11' }).expect(
      200,
    );
  });

  it('limits to 15 requests per minute per session even across IPs', async () => {
    const { app } = await createApp(Array.from({ length: 16 }, () => ({ text: 'ok' })));
    const sid = session();
    for (let i = 0; i < 15; i += 1) {
      await chat(app, sid, { message: 'oi' }, { 'X-Forwarded-For': `198.51.100.${i + 1}` }).expect(
        200,
      );
    }
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('X-Session-Id', sid)
      .set('X-Forwarded-For', '198.51.100.99')
      .send({ message: 'oi' })
      .expect(429);
    expect((res.body as ErrorBody).error.code).toBe('RATE_LIMITED');
  });

  it('answers 429 BUDGET_EXCEEDED once the daily ceiling is reached', async () => {
    const used = await prisma.message.count({
      where: { role: 'USER', createdAt: { gte: startOfDaySaoPaulo(new Date()) } },
    });
    const { app, provider } = await createApp([{ text: 'nunca' }], { maxDaily: used });
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .set('X-Session-Id', session())
      .send({ message: 'oi' })
      .expect(429);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({
      error: {
        code: 'BUDGET_EXCEEDED',
        message: 'A demo atingiu o limite de conversas de hoje. Volte amanhã!',
      },
    });
    expect(provider.calls).toHaveLength(0);
  });
});
