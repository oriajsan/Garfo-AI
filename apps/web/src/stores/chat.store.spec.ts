import type { ChatEvent } from '@garfo/shared';

jest.mock('@/lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { getMessages: jest.fn() },
  NETWORK_ERROR_MESSAGE: 'rede',
}));
jest.mock('@/lib/session', () => ({
  getStoredConversationId: jest.fn(() => null),
  storeConversationId: jest.fn(),
}));
jest.mock('@/lib/silence-watcher', () => ({
  createSilenceWatcher: () => ({ touch: jest.fn(), stop: jest.fn() }),
}));
jest.mock('./cart.store', () => ({ useCartStore: { getState: () => ({ setCart: jest.fn() }) } }));

const streamChat = jest.fn();
jest.mock('@/lib/sse', () => ({
  streamChat: (...args: unknown[]) => streamChat(...args),
}));

import { useChatStore } from './chat.store';

const USAGE = { usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
const token = (text: string): ChatEvent => ({ type: 'token', data: { text } });
const reset: ChatEvent = { type: 'message_reset', data: { reason: 'truncated' } };

/** Plays `events` as the server's stream for the next `send`. */
async function play(events: ChatEvent[]): Promise<void> {
  streamChat.mockImplementationOnce(
    (_m: string, _c: string | null, handlers: { onEvent: (e: ChatEvent) => void }) => {
      for (const event of events) handlers.onEvent(event);
      return Promise.resolve();
    },
  );
  await useChatStore.getState().send('oi');
}

const assistant = () => useChatStore.getState().messages.at(-1);

describe('chat store message_reset', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('wipes the partial text of the current call and keeps what comes next', async () => {
    await play([
      token('O Homus é do restaurante *'),
      reset,
      token('O Homus é do Oriente.'),
      { type: 'done', data: USAGE },
    ]);
    expect(assistant()?.text).toBe('O Homus é do Oriente.');
    expect(useChatStore.getState().status).toBe('idle');
  });

  it('keeps tool indicators and text written before the tool run', async () => {
    await play([
      token('Vou buscar. '),
      { type: 'tool_start', data: { id: 't1', name: 'search_dishes', label: 'Buscando' } },
      { type: 'tool_end', data: { id: 't1', name: 'search_dishes', ok: true } },
      token('Achei o *'),
      reset,
      token('Achei o Homus.'),
      { type: 'done', data: USAGE },
    ]);
    expect(assistant()?.text).toBe('Vou buscar. Achei o Homus.');
    expect(assistant()?.tools).toEqual([{ id: 't1', label: 'Buscando', done: true, ok: true }]);
  });

  it('leaves no cut text behind when the retry also fails (reset, then error)', async () => {
    await play([
      token('cortado *'),
      reset,
      token('cortado de novo *'),
      reset,
      { type: 'error', data: { code: 'LLM_ERROR', message: 'falhou' } },
    ]);
    // The empty bubble is dropped, so no truncated text stays on screen.
    expect(useChatStore.getState().messages.map((m) => m.role)).toEqual(['user']);
    expect(useChatStore.getState().error?.code).toBe('LLM_ERROR');
  });
});
