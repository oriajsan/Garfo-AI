import type { ChatEvent, DishCard, ErrorCode } from '@garfo/shared';
import { create } from 'zustand';
import { ApiRequestError, api, NETWORK_ERROR_MESSAGE } from '@/lib/api';
import { getStoredConversationId, storeConversationId } from '@/lib/session';
import { createSilenceWatcher } from '@/lib/silence-watcher';
import { streamChat } from '@/lib/sse';
import { useCartStore } from './cart.store';

export interface ToolRun {
  id: string;
  label: string;
  done: boolean;
  ok: boolean;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  dishCards: DishCard[];
  tools: ToolRun[];
}

export interface ChatError {
  code: ErrorCode | null;
  message: string;
}

export type ChatStatus = 'idle' | 'streaming' | 'error';

interface ChatState {
  messages: UiMessage[];
  conversationId: string | null;
  status: ChatStatus;
  error: ChatError | null;
  /** 8 s without any stream event while streaming: show the "slower than usual" notice. */
  slow: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  dismissError: () => void;
}

/** Per-request state of the SSE handler. */
export interface StreamFlags {
  finished: boolean;
  /** Length of the assistant text when the current model call began (see `message_reset`). */
  attemptStart: number;
}

let abortController: AbortController | null = null;
let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${counter++}`;

export const useChatStore = create<ChatState>((set, get) => {
  /** Applies `fn` to the assistant message being streamed (always the last one). */
  const patchLast = (fn: (message: UiMessage) => UiMessage): void =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return state;
      return { messages: [...state.messages.slice(0, -1), fn(last)] };
    });

  /** Drops the last assistant message when nothing arrived for it (avoids an empty bubble). */
  const dropEmptyAssistant = (): void =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      const empty =
        last &&
        last.role === 'assistant' &&
        !last.text &&
        last.dishCards.length === 0 &&
        last.tools.length === 0;
      return empty ? { messages: state.messages.slice(0, -1) } : state;
    });

  const handleEvent = (event: ChatEvent, flags: StreamFlags): void => {
    switch (event.type) {
      case 'meta':
        storeConversationId(event.data.conversationId);
        set({ conversationId: event.data.conversationId });
        break;
      case 'token':
        patchLast((m) => ({ ...m, text: m.text + event.data.text }));
        break;
      case 'message_reset':
        // Wipe only the text of the current model call; text before a tool run is kept.
        patchLast((m) => ({ ...m, text: m.text.slice(0, flags.attemptStart) }));
        break;
      case 'tool_start':
        patchLast((m) => ({
          ...m,
          tools: [
            ...m.tools,
            { id: event.data.id, label: event.data.label, done: false, ok: true },
          ],
        }));
        break;
      case 'tool_end':
        patchLast((m) => {
          // The next model call starts here: a later reset must not reach back past this point.
          flags.attemptStart = m.text.length;
          return {
            ...m,
            tools: m.tools.map((t) =>
              t.id === event.data.id ? { ...t, done: true, ok: event.data.ok } : t,
            ),
          };
        });
        break;
      case 'dish_cards':
        patchLast((m) => {
          const known = new Set(m.dishCards.map((d) => d.id));
          return {
            ...m,
            dishCards: [...m.dishCards, ...event.data.dishes.filter((d) => !known.has(d.id))],
          };
        });
        break;
      case 'cart_updated':
        useCartStore.getState().setCart(event.data.cart);
        break;
      case 'done':
        flags.finished = true;
        break;
      case 'error':
        flags.finished = true;
        set({ error: { code: event.data.code, message: event.data.message }, status: 'error' });
        break;
    }
  };

  return {
    messages: [],
    conversationId: null,
    status: 'idle',
    error: null,
    slow: false,
    hydrated: false,

    async hydrate() {
      const id = getStoredConversationId();
      if (!id) {
        set({ hydrated: true });
        return;
      }
      try {
        const data = await api.getMessages(id);
        // A message sent while this request was in flight wins over the stored history.
        if (get().messages.length === 0) {
          set({
            conversationId: data.conversationId,
            messages: data.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.text,
              dishCards: m.dishCards,
              tools: [],
            })),
          });
        }
      } catch (error) {
        // Unknown conversation (for instance after a database reset): start from scratch.
        if (error instanceof ApiRequestError && error.status === 404) storeConversationId(null);
      } finally {
        set({ hydrated: true });
      }
    },

    async send(text) {
      const message = text.trim();
      if (!message || get().status === 'streaming') return;

      const controller = new AbortController();
      abortController = controller;
      const { signal } = controller;
      const flags: StreamFlags = { finished: false, attemptStart: 0 };
      const watcher = createSilenceWatcher((slow) => set({ slow }));
      set((state) => ({
        status: 'streaming',
        error: null,
        messages: [
          ...state.messages,
          { id: nextId('u'), role: 'user', text: message, dishCards: [], tools: [] },
          { id: nextId('a'), role: 'assistant', text: '', dishCards: [], tools: [] },
        ],
      }));

      try {
        await streamChat(
          message,
          get().conversationId,
          {
            onEvent: (e) => {
              watcher.touch();
              handleEvent(e, flags);
            },
          },
          signal,
        );
        // The stream may also close with neither `done` nor `error` (proxy cut, server restart).
        if (!flags.finished && !signal.aborted && get().status === 'streaming') {
          set({ error: { code: null, message: NETWORK_ERROR_MESSAGE }, status: 'error' });
        }
      } catch (error) {
        const known = error instanceof ApiRequestError;
        set({
          error: {
            code: known ? error.code : null,
            message: known ? error.message : NETWORK_ERROR_MESSAGE,
          },
          status: 'error',
        });
      } finally {
        watcher.stop();
        // A reset (new conversation) may already have started another round: leave it alone.
        if (abortController === controller) {
          abortController = null;
          dropEmptyAssistant();
          if (get().status === 'streaming') set({ status: 'idle' });
        }
      }
    },

    stop() {
      abortController?.abort();
    },

    reset() {
      abortController?.abort();
      storeConversationId(null);
      set({ messages: [], conversationId: null, status: 'idle', error: null, slow: false });
    },

    dismissError() {
      set((state) => ({ error: null, status: state.status === 'error' ? 'idle' : state.status }));
    },
  };
});
