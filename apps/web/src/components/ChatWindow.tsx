'use client';

import { MAX_MESSAGE_LENGTH } from '@garfo/shared';
import clsx from 'clsx';
import { ArrowUp, Square, UtensilsCrossed } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useChatStore } from '@/stores/chat.store';
import { ErrorBanner } from './ErrorBanner';
import { MessageBubble } from './MessageBubble';
import { SuggestionChips } from './SuggestionChips';

const STICK_THRESHOLD_PX = 140;

export function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const hydrated = useChatStore((s) => s.hydrated);
  const slow = useChatStore((s) => s.slow);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const dismissError = useChatStore((s) => s.dismissError);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const streaming = status === 'streaming';

  // Auto-scroll while the user is near the bottom; scrolling up pauses it.
  useLayoutEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }, []);

  // Grow the textarea with its content, up to ~6 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || useChatStore.getState().status === 'streaming') return;
      stickRef.current = true;
      setDraft('');
      void send(value);
    },
    [send],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  };

  const empty = messages.length === 0;
  const canSend = draft.trim().length > 0 && !streaming;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Conversa com o Garfo"
        className="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-5 sm:px-6 lg:pb-5"
      >
        <div
          className={clsx(
            'mx-auto flex w-full max-w-3xl flex-col gap-5',
            empty && 'min-h-full justify-center',
          )}
        >
          {empty
            ? hydrated && (
                <div className="flex flex-col items-center gap-6 py-6 text-center motion-safe:animate-fade-up">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-md">
                    <UtensilsCrossed className="h-7 w-7" aria-hidden />
                  </span>
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                      O que você quer comer hoje?
                    </h1>
                    <p className="mx-auto max-w-md text-[15px] text-stone-600 dark:text-stone-400">
                      Descreva em poucas palavras e eu busco pratos de verdade no cardápio, com os
                      filtros que você pedir.
                    </p>
                  </div>
                  <SuggestionChips onPick={submit} disabled={streaming} />
                </div>
              )
            : messages.map((message, index) => (
                <div key={message.id} className="motion-safe:animate-fade-up">
                  <MessageBubble
                    message={message}
                    streaming={streaming && index === messages.length - 1}
                    slow={slow && streaming && index === messages.length - 1}
                  />
                </div>
              ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-200 bg-white/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 dark:border-stone-800 dark:bg-stone-950/80">
        {error && <ErrorBanner error={error} onDismiss={dismissError} />}
        <form
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-stone-300 bg-white p-2 shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/30 dark:border-stone-700 dark:bg-stone-900"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Mensagem para o Garfo
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ex.: algo vegetariano até R$ 40"
            className="max-h-36 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none placeholder:text-stone-500 dark:placeholder:text-stone-400"
          />
          <span
            className={clsx(
              'mb-2.5 hidden text-xs tabular-nums sm:block',
              draft.length > MAX_MESSAGE_LENGTH - 50
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-stone-500 dark:text-stone-400',
            )}
            aria-label={`${draft.length} de ${MAX_MESSAGE_LENGTH} caracteres`}
          >
            {draft.length}/{MAX_MESSAGE_LENGTH}
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Parar resposta"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-800 text-white transition-colors hover:bg-stone-900 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-white"
            >
              <Square className="h-4 w-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Enviar mensagem"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition-colors hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 dark:disabled:bg-stone-800 dark:disabled:text-stone-600"
            >
              <ArrowUp className="h-5 w-5" aria-hidden />
            </button>
          )}
        </form>
        <p className="mx-auto mt-1.5 hidden max-w-3xl px-1 text-xs text-stone-500 sm:block dark:text-stone-400">
          Enter envia, Shift+Enter quebra linha.
        </p>
      </div>
    </div>
  );
}
