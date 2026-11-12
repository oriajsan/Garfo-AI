'use client';

import { DIETARY_TAG_LABELS, formatBRL, type DishCard as DishCardData } from '@garfo/shared';
import clsx from 'clsx';
import { Check, Clock, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useAddToCart, useReplaceCartAndAdd } from '@/lib/queries';

type Feedback = { kind: 'conflict'; message: string } | { kind: 'error'; message: string } | null;

export function DishCard({ dish }: { dish: DishCardData }) {
  const add = useAddToCart();
  const replace = useReplaceCartAndAdd();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [added, setAdded] = useState(false);
  const busy = add.isPending || replace.isPending;

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), 1800);
    return () => clearTimeout(timer);
  }, [added]);

  const run = async (mutate: () => Promise<unknown>): Promise<void> => {
    setFeedback(null);
    try {
      await mutate();
      setAdded(true);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'DIFFERENT_RESTAURANT') {
        setFeedback({ kind: 'conflict', message: error.message });
      } else {
        setFeedback({
          kind: 'error',
          message:
            error instanceof ApiRequestError
              ? error.message
              : 'Não foi possível adicionar. Tente de novo.',
        });
      }
    }
  };

  const eta =
    dish.deliveryMinMinutes === dish.deliveryMaxMinutes
      ? `${dish.deliveryMaxMinutes} min`
      : `${dish.deliveryMinMinutes}–${dish.deliveryMaxMinutes} min`;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-2xl dark:bg-brand-900/40"
          aria-hidden
        >
          {dish.restaurant.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-stone-900 dark:text-stone-50">
            {dish.name}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">{dish.restaurant.name}</p>
        </div>
        <p className="shrink-0 text-base font-bold text-stone-900 dark:text-stone-50">
          {formatBRL(dish.priceCents)}
        </p>
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-stone-600 dark:text-stone-300">
        {dish.description}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ul className="flex flex-1 flex-wrap items-center gap-1.5" aria-label="Características">
          {dish.dietaryTags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              {DIETARY_TAG_LABELS[tag]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {eta}
          </li>
        </ul>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => add.mutateAsync(dish.id))}
          aria-label={`Adicionar ${dish.name} ao carrinho`}
          className={clsx(
            'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition-colors sm:w-auto',
            added ? 'bg-emerald-700' : 'bg-brand-700 hover:bg-brand-800',
            'disabled:opacity-70',
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : added ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          {added ? 'Adicionado' : 'Adicionar'}
        </button>
      </div>

      {feedback?.kind === 'conflict' && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{feedback.message}</span>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => replace.mutateAsync(dish.id))}
              className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-70"
            >
              Esvaziar carrinho e adicionar
            </button>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50"
            >
              Manter carrinho
            </button>
          </div>
        </div>
      )}
      {feedback?.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm text-amber-800 dark:text-amber-300">
          {feedback.message}
        </p>
      )}
    </article>
  );
}
