'use client';

import { formatBRL } from '@garfo/shared';
import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useClearCart, useUpdateCartItem } from '@/lib/queries';
import { useCartStore } from '@/stores/cart.store';

export function CartPanel({ onCheckout }: { onCheckout: () => void }) {
  const cart = useCartStore((s) => s.cart);
  const update = useUpdateCartItem();
  const clear = useClearCart();

  if (!cart) {
    return (
      <div
        className="flex flex-1 flex-col gap-3 p-5"
        aria-busy="true"
        aria-label="Carregando carrinho"
      >
        <div className="h-5 w-32 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-14 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-900" />
        <div className="h-14 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-900" />
      </div>
    );
  }

  const empty = cart.items.length === 0;
  const belowMin = cart.missingForMinOrderCents > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Seu pedido</h2>
          {cart.restaurant && (
            <p className="truncate text-sm text-stone-500 dark:text-stone-400">
              <span aria-hidden>{cart.restaurant.emoji}</span> {cart.restaurant.name}
            </p>
          )}
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
            className="rounded-lg px-2 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-60 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Esvaziar
          </button>
        )}
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 pb-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
            <ShoppingBag className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm font-medium">Seu carrinho está vazio</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Peça uma sugestão no chat e adicione os pratos por aqui.
          </p>
        </div>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto px-5 pb-3" aria-label="Itens do carrinho">
          {cart.items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug">{item.name}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatBRL(item.lineTotalCents)}
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {formatBRL(item.priceCents)} cada
                </p>
                <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 dark:border-stone-700">
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ itemId: item.id, quantity: item.quantity - 1 })}
                    aria-label={
                      item.quantity === 1
                        ? `Remover ${item.name}`
                        : `Diminuir quantidade de ${item.name}`
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-l-lg hover:bg-stone-100 disabled:opacity-60 dark:hover:bg-stone-800"
                  >
                    {item.quantity === 1 ? (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    ) : (
                      <Minus className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                  <span
                    className="w-6 text-center text-sm font-semibold tabular-nums"
                    aria-label={`Quantidade: ${item.quantity}`}
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    disabled={update.isPending || item.quantity >= 10}
                    onClick={() => update.mutate({ itemId: item.id, quantity: item.quantity + 1 })}
                    aria-label={`Aumentar quantidade de ${item.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-r-lg hover:bg-stone-100 disabled:opacity-60 dark:hover:bg-stone-800"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="shrink-0 space-y-3 border-t border-stone-200 p-5 dark:border-stone-800">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between text-stone-600 dark:text-stone-300">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatBRL(cart.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between text-stone-600 dark:text-stone-300">
            <dt>Entrega</dt>
            <dd className="tabular-nums">
              {empty
                ? '—'
                : cart.deliveryFeeCents === 0
                  ? 'Grátis'
                  : formatBRL(cart.deliveryFeeCents)}
            </dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatBRL(cart.totalCents)}</dd>
          </div>
        </dl>
        {!empty && belowMin && (
          <p
            className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            Faltam {formatBRL(cart.missingForMinOrderCents)} para o pedido mínimo de{' '}
            {formatBRL(cart.minOrderCents)}.
          </p>
        )}
        <button
          type="button"
          onClick={onCheckout}
          disabled={empty || belowMin}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none dark:disabled:bg-stone-800 dark:disabled:text-stone-500"
        >
          {(update.isPending || clear.isPending) && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          Finalizar pedido
        </button>
      </div>
    </div>
  );
}
