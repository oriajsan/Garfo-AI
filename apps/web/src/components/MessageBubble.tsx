import clsx from 'clsx';
import { UtensilsCrossed } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { UiMessage } from '@/stores/chat.store';
import { DishCard } from './DishCard';
import { ToolActivity } from './ToolActivity';

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 py-1"
      role="status"
      aria-label="O assistente está digitando"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 motion-reduce:animate-none dark:bg-stone-500"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function MessageBubble({ message, streaming }: { message: UiMessage; streaming: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
          {message.text}
        </p>
      </div>
    );
  }

  const waiting = streaming && !message.text && message.dishCards.length === 0;
  const runningTool = message.tools.some((t) => !t.done);
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-300"
        aria-hidden
      >
        <UtensilsCrossed className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 max-w-[92%] flex-1 space-y-3">
        {(message.tools.length > 0 || message.text || waiting) && (
          <div
            className={clsx(
              'inline-block max-w-full rounded-2xl rounded-tl-md border border-stone-200 bg-white px-4 py-2.5 shadow-sm',
              'dark:border-stone-800 dark:bg-stone-900',
            )}
          >
            <ToolActivity tools={message.tools} />
            {message.text && (
              <div className="chat-prose break-words text-[15px] leading-relaxed">
                <ReactMarkdown>{message.text}</ReactMarkdown>
              </div>
            )}
            {waiting && !runningTool && <TypingDots />}
          </div>
        )}
        {message.dishCards.length > 0 && (
          <div className="space-y-2.5">
            {message.dishCards.map((dish) => (
              <DishCard key={dish.id} dish={dish} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
