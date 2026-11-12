import { Logger } from '@nestjs/common';
import { type ChatEvent, type DishCard } from '@garfo/shared';
import { type CartService } from '../cart/cart.service';
import { type SearchService } from '../catalog/search.service';
import { DomainError } from '../common/domain-error';
import { FakeLlmProvider, type FakeTurn } from '../llm/fake-llm.provider';
import { type LlmChatInput, type LlmProvider, type LlmStreamChunk } from '../llm/llm.types';
import { DISH_1, DISH_2, emptyCart, makeCart, makeDish, UNKNOWN_DISH } from '../testing/fixtures';
import { ToolRegistry } from '../tools/tool.registry';
import {
  AgentService,
  EMPTY_ANSWER_TEXT,
  ITERATION_LIMIT_TEXT,
  LLM_ERROR_TEXT,
  MAX_ITERATIONS,
} from './agent.service';
import { ConversationRepository, type MessageRecord } from './conversation.repository';
import { type PrismaService } from '../prisma/prisma.service';

const SESSION = 'session-1';
const CONVERSATION = 'conv-1';

function card(id: string, name: string): DishCard {
  return {
    id,
    name,
    description: 'd',
    priceCents: 1000,
    dietaryTags: [],
    restaurant: { slug: 'r', name: 'R', emoji: '🍽️' },
    deliveryMinMinutes: 10,
    deliveryMaxMinutes: 20,
  };
}

interface Setup {
  agent: AgentService;
  provider: LlmProvider & { calls?: LlmChatInput[] };
  events: ChatEvent[];
  search: {
    search: jest.Mock;
    getDishCards: jest.Mock;
    getDish: jest.Mock;
    getRestaurant: jest.Mock;
  };
  cart: { getCart: jest.Mock; addItem: jest.Mock; updateItem: jest.Mock; clear: jest.Mock };
  conversations: { loadHistory: jest.Mock; loadSeenDishes: jest.Mock; saveRound: jest.Mock };
  run: (message?: string, signal?: AbortSignal) => Promise<void>;
  types: () => string[];
  saved: () => MessageRecord[];
}

function setup(
  script: FakeTurn[] | LlmProvider,
  options: { seen?: Array<[string, string]>; history?: unknown[] } = {},
): Setup {
  const provider = Array.isArray(script) ? new FakeLlmProvider(script) : script;
  const search = {
    search: jest.fn().mockResolvedValue([makeDish(), makeDish({ id: DISH_2, name: 'Cartola' })]),
    getDishCards: jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => card(id, id === DISH_1 ? 'Baião de dois' : 'Cartola'))),
    ),
    getDish: jest.fn(),
    getRestaurant: jest.fn(),
  };
  const cart = {
    getCart: jest.fn().mockResolvedValue(emptyCart()),
    addItem: jest.fn().mockResolvedValue(makeCart()),
    updateItem: jest.fn(),
    clear: jest.fn(),
  };
  const conversations = {
    loadHistory: jest.fn().mockResolvedValue(options.history ?? []),
    loadSeenDishes: jest.fn().mockResolvedValue(new Map(options.seen ?? [])),
    saveRound: jest.fn().mockResolvedValue(undefined),
  };
  const registry = new ToolRegistry(
    search as unknown as SearchService,
    cart as unknown as CartService,
  );
  const agent = new AgentService(
    provider,
    registry,
    conversations as unknown as ConversationRepository,
    cart as unknown as CartService,
    search as unknown as SearchService,
  );
  const events: ChatEvent[] = [];
  return {
    agent,
    provider,
    events,
    search,
    cart,
    conversations,
    run: (message = 'oi', signal = new AbortController().signal) =>
      agent.run(
        { sessionId: SESSION, conversationId: CONVERSATION, message },
        (event) => events.push(event),
        signal,
      ),
    types: () => collapse(events.map((e) => e.type)),
    saved: () => (conversations.saveRound.mock.calls[0] as [string, MessageRecord[]])[1],
  };
}

/** ['meta', 'token', 'token', 'done'] -> ['meta', 'token', 'done'] */
function collapse(types: string[]): string[] {
  return types.filter((type, index) => !(type === 'token' && types[index - 1] === 'token'));
}

const tokensOf = (events: ChatEvent[]): string =>
  events.map((e) => (e.type === 'token' ? e.data.text : '')).join('');

describe('AgentService', () => {
  it('searches, answers with markers and emits the exact event sequence', async () => {
    const s = setup([
      {
        toolCalls: [
          {
            id: 'call_a',
            name: 'search_dishes',
            args: { query: 'algo vegetariano', dietary_tags: ['vegetarian'], max_price_reais: 40 },
          },
        ],
      },
      { text: `Recomendo o Baião de dois do Sertão por R$ 32,90 [[dish:${DISH_1}]]. Bom apetite!` },
    ]);
    await s.run('algo vegetariano até R$ 40');

    expect(s.types()).toEqual(['meta', 'tool_start', 'tool_end', 'token', 'dish_cards', 'done']);
    expect(s.events[0]).toEqual({ type: 'meta', data: { conversationId: CONVERSATION } });
    expect(s.events[1]).toEqual({
      type: 'tool_start',
      data: {
        id: 'call_a',
        name: 'search_dishes',
        label: 'Buscando pratos vegetarianos até R$ 40…',
      },
    });
    expect(s.events[2]).toEqual({
      type: 'tool_end',
      data: { id: 'call_a', name: 'search_dishes', ok: true },
    });
    expect(tokensOf(s.events)).toBe(
      'Recomendo o Baião de dois do Sertão por R$ 32,90. Bom apetite!',
    );
    expect(s.search.search).toHaveBeenCalledWith(
      expect.objectContaining({ maxPriceCents: 4000, dietaryTags: ['vegetarian'] }),
    );

    const cards = s.events.find((e) => e.type === 'dish_cards');
    expect(cards?.type === 'dish_cards' && cards.data.dishes.map((d) => d.id)).toEqual([DISH_1]);

    const done = s.events.at(-1);
    expect(done?.type === 'done' && done.data.usage.inputTokens).toBeGreaterThan(0);
    expect(done?.type === 'done' && done.data.latencyMs).toBeGreaterThanOrEqual(0);

    // Persisted once, raw text with the marker, tool call/result linked by id.
    expect(s.conversations.saveRound).toHaveBeenCalledTimes(1);
    expect(s.saved()).toEqual([
      { role: 'USER', content: { text: 'algo vegetariano até R$ 40' } },
      {
        role: 'ASSISTANT',
        content: {
          text: '',
          toolCalls: [
            {
              id: 'call_a',
              name: 'search_dishes',
              argsJson:
                '{"query":"algo vegetariano","dietary_tags":["vegetarian"],"max_price_reais":40}',
            },
          ],
        },
      },
      {
        role: 'TOOL',
        content: {
          toolCallId: 'call_a',
          name: 'search_dishes',
          result: expect.anything() as unknown,
        },
      },
      {
        role: 'ASSISTANT',
        content: {
          text: `Recomendo o Baião de dois do Sertão por R$ 32,90 [[dish:${DISH_1}]]. Bom apetite!`,
          dishIds: [DISH_1],
        },
      },
    ]);
  });

  it('sends the assistant tool_calls message before each tool message on the next call', async () => {
    const s = setup([
      {
        toolCalls: [
          { id: 'c1', name: 'search_dishes', args: { query: 'a' } },
          { id: 'c2', name: 'view_cart', args: {} },
        ],
      },
      { text: 'ok' },
    ]);
    await s.run();
    const second = (s.provider as FakeLlmProvider).calls[1];
    expect(second?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    const assistant = second?.messages[1];
    expect(assistant?.role === 'assistant' && assistant.toolCalls?.map((c) => c.id)).toEqual([
      'c1',
      'c2',
    ]);
    expect(second?.messages.slice(2).map((m) => (m.role === 'tool' ? m.toolCallId : ''))).toEqual([
      'c1',
      'c2',
    ]);
    expect(second?.system).toContain('Carrinho atual: vazio.');
    expect(second?.maxTokens).toBe(800);
    expect(second?.tools).toHaveLength(7);
  });

  it('returns invalid tool arguments as a VALIDATION_ERROR result and keeps going', async () => {
    const s = setup([
      { toolCalls: [{ id: 'bad', name: 'search_dishes', args: { query: 'x', limit: 99 } }] },
      { text: 'Vou tentar de outro jeito.' },
    ]);
    await s.run();

    expect(s.search.search).not.toHaveBeenCalled();
    const end = s.events.find((e) => e.type === 'tool_end');
    expect(end).toEqual({
      type: 'tool_end',
      data: { id: 'bad', name: 'search_dishes', ok: false },
    });
    const tool = s.saved().find((r) => r.role === 'TOOL');
    expect(tool?.role === 'TOOL' && tool.content.result).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(s.types().at(-1)).toBe('done');
  });

  it('hands DIFFERENT_RESTAURANT to the model as a result and relays its explanation', async () => {
    const s = setup([
      { toolCalls: [{ id: 'add', name: 'add_to_cart', args: { dish_id: DISH_2, quantity: 1 } }] },
      { text: 'Seu carrinho é do Sertão Arretado. Quer esvaziá-lo para pedir deste outro lugar?' },
    ]);
    s.cart.addItem.mockRejectedValue(
      new DomainError('DIFFERENT_RESTAURANT', 'Seu carrinho já tem itens do Sertão Arretado.'),
    );
    await s.run('adiciona a pizza');

    expect(s.types()).toEqual(['meta', 'tool_start', 'tool_end', 'token', 'done']);
    expect(s.events.some((e) => e.type === 'cart_updated')).toBe(false);
    const second = (s.provider as FakeLlmProvider).calls[1];
    const toolMessage = second?.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.role === 'tool' && toolMessage.content).toContain('DIFFERENT_RESTAURANT');
    expect(tokensOf(s.events)).toContain('esvaziá-lo');
  });

  it('emits cart_updated after add_to_cart, labelling with names from earlier turns', async () => {
    const s = setup(
      [
        { toolCalls: [{ id: 'add', name: 'add_to_cart', args: { dish_id: DISH_1, quantity: 2 } }] },
        { text: 'Adicionei! Revise e clique em "Finalizar pedido".' },
      ],
      { seen: [[DISH_1, 'Baião de dois']] },
    );
    await s.run('quero esse');

    expect(s.types()).toEqual(['meta', 'tool_start', 'tool_end', 'cart_updated', 'token', 'done']);
    const start = s.events.find((e) => e.type === 'tool_start');
    expect(start?.type === 'tool_start' && start.data.label).toBe(
      'Adicionando 2× Baião de dois ao carrinho…',
    );
    const updated = s.events.find((e) => e.type === 'cart_updated');
    expect(updated?.type === 'cart_updated' && updated.data.cart.itemCount).toBe(2);
  });

  it('stops after 6 iterations with the default message', async () => {
    const turns: FakeTurn[] = Array.from({ length: MAX_ITERATIONS + 2 }, (_, i) => ({
      toolCalls: [{ id: `v${i}`, name: 'view_cart', args: {} }],
    }));
    const s = setup(turns);
    await s.run();

    expect((s.provider as FakeLlmProvider).calls).toHaveLength(MAX_ITERATIONS);
    expect(s.events.filter((e) => e.type === 'tool_start')).toHaveLength(MAX_ITERATIONS);
    expect(tokensOf(s.events)).toBe(ITERATION_LIMIT_TEXT);
    expect(s.types().at(-1)).toBe('done');
    const last = s.saved().at(-1);
    expect(last).toEqual({ role: 'ASSISTANT', content: { text: ITERATION_LIMIT_TEXT } });
  });

  it('discards hallucinated ids, logs them and never shows their markers', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const s = setup(
      [{ text: `Tente [[dish:${UNKNOWN_DISH}]] ou [[dish:${DISH_1}]] ou [[dish:123]].` }],
      { seen: [[DISH_1, 'Baião de dois']] },
    );
    await s.run();

    const cards = s.events.find((e) => e.type === 'dish_cards');
    expect(cards?.type === 'dish_cards' && cards.data.dishes.map((d) => d.id)).toEqual([DISH_1]);
    expect(s.search.getDishCards).toHaveBeenCalledWith([DISH_1]);
    expect(tokensOf(s.events)).not.toContain('[[dish:');
    expect(tokensOf(s.events)).toBe('Tente ou ou.');
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('possible_hallucination');
    expect(logged).toContain(UNKNOWN_DISH);
    expect(s.saved().at(-1)).toMatchObject({ content: { dishIds: [DISH_1] } });
    warn.mockRestore();
  });

  it('does not emit dish_cards when every cited id is unknown', async () => {
    const s = setup([{ text: `Veja [[dish:${UNKNOWN_DISH}]]` }]);
    await s.run();
    expect(s.types()).toEqual(['meta', 'token', 'done']);
    expect(s.search.getDishCards).not.toHaveBeenCalled();
  });

  it('only shows cards for dishes a tool returned in the conversation', async () => {
    const s = setup([{ text: `Veja [[dish:${DISH_1}]]` }]);
    await s.run();
    expect(s.events.some((e) => e.type === 'dish_cards')).toBe(false);
  });

  it('aborts without persisting or emitting anything after the abort', async () => {
    const controller = new AbortController();
    const s = setup([{ text: 'Uma resposta bem longa que será interrompida no meio do caminho.' }]);
    let seenAtAbort = 0;
    const originalPush = s.events.push.bind(s.events);
    s.events.push = (...items: ChatEvent[]) => {
      const length = originalPush(...items);
      if (items.some((e) => e.type === 'token') && !controller.signal.aborted) {
        seenAtAbort = length;
        controller.abort();
      }
      return length;
    };
    await s.run('oi', controller.signal);

    expect(s.events).toHaveLength(seenAtAbort);
    expect(s.events.some((e) => e.type === 'done')).toBe(false);
    expect(s.conversations.saveRound).not.toHaveBeenCalled();
  });

  it('aborts between tool calls', async () => {
    const controller = new AbortController();
    const s = setup([
      {
        toolCalls: [
          { id: 'a', name: 'view_cart', args: {} },
          { id: 'b', name: 'view_cart', args: {} },
        ],
      },
    ]);
    s.cart.getCart.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(emptyCart());
    });
    await s.run('oi', controller.signal);
    expect(s.events.filter((e) => e.type === 'tool_start')).toHaveLength(0);
    expect(s.conversations.saveRound).not.toHaveBeenCalled();
  });

  it('stays silent when the provider fails because of the abort', async () => {
    const controller = new AbortController();
    const provider: LlmProvider = {
      chat: () => {
        controller.abort();
        throw new Error('The operation was aborted');
      },
    };
    const s = setup(provider);
    await s.run('oi', controller.signal);
    expect(s.types()).toEqual(['meta']);
    expect(s.conversations.saveRound).not.toHaveBeenCalled();
  });

  it('turns a provider failure into an LLM_ERROR event and persists nothing', async () => {
    const provider: LlmProvider = {
      chat: () => ({
        [Symbol.asyncIterator]: () => ({
          next: (): Promise<IteratorResult<LlmStreamChunk>> =>
            Promise.reject(new Error('401 invalid api key sk-secret')),
        }),
      }),
    };
    const s = setup(provider);
    await s.run();

    expect(s.types()).toEqual(['meta', 'error']);
    expect(s.events.at(-1)).toEqual({
      type: 'error',
      data: { code: 'LLM_ERROR', message: LLM_ERROR_TEXT },
    });
    expect(JSON.stringify(s.events)).not.toContain('sk-secret');
    expect(s.conversations.saveRound).not.toHaveBeenCalled();
  });

  it('reports a persistence failure as an error instead of done', async () => {
    const s = setup([{ text: 'oi' }]);
    s.conversations.saveRound.mockRejectedValue(new Error('db down'));
    await s.run();
    expect(s.events.at(-1)).toMatchObject({ type: 'error', data: { code: 'INTERNAL_ERROR' } });
    expect(s.events.some((e) => e.type === 'done')).toBe(false);
  });

  it('answers with a default text when the model returns nothing', async () => {
    const s = setup([{ text: '' }]);
    await s.run();
    expect(tokensOf(s.events)).toBe(EMPTY_ANSWER_TEXT);
    expect(s.types().at(-1)).toBe('done');
  });

  it('feeds the model a history that starts at a USER message', async () => {
    // 20 stored rows (newest first, as the query returns them) cut in the middle of a round.
    const rows = [
      { id: '5', role: 'ASSISTANT', content: { text: 'resposta' } },
      { id: '4', role: 'USER', content: { text: 'pergunta' } },
      { id: '3', role: 'TOOL', content: { toolCallId: 'x', name: 'search_dishes', result: {} } },
      { id: '2', role: 'ASSISTANT', content: { text: 'resto do corte' } },
    ].map((row, i) => ({ ...row, conversationId: CONVERSATION, createdAt: new Date(100 - i) }));
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { message: { findMany } } as unknown as PrismaService;
    const repository = new ConversationRepository(prisma);
    const history = await repository.loadHistory(CONVERSATION);
    expect(history).toEqual([
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: 'resposta' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, where: { conversationId: CONVERSATION } }),
    );

    const s = setup([{ text: 'ok' }], { history });
    await s.run('nova pergunta');
    const first = (s.provider as FakeLlmProvider).calls[0];
    expect(first?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
