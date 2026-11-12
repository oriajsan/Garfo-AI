'use client';

import { formatBRL } from '@garfo/shared';
import { CheckCircle2, Clock, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useCheckout } from '@/lib/queries';
import { useCartStore } from '@/stores/cart.store';
import { useModal } from './useModal';

function orderNumber(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

function errorText(error: unknown, fallbackMissing: number): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'BELOW_MIN_ORDER') {
      const raw = error.details?.missingCents;
      const missing = typeof raw === 'number' ? raw : fallbackMissing;
      return missing > 0
        ? `Faltam ${formatBRL(missing)} para atingir o pedido mínimo deste restaurante.`
        : error.message;
    }
    return error.message;
  }
  return 'Não foi possível finalizar o pedido. Tente de novo.';
}

export function CheckoutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCartStore((s) => s.cart);
  const checkout = useCheckout();
  const panelRef = useRef<HTMLDivElement>(null);
  const { reset } = checkout;

  const close = useCallback(() => onClose(), [onClose]);
  useModal(open, close, panelRef);

  // Each time the dialog opens it starts from the summary, not from the last result.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  if (!open) return null;

  const done = checkout.data;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-stone-950/60" onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-labelledby="checkout-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl outline-none motion-safe:animate-fade-up sm:rounded-3xl dark:bg-stone-900"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
            <CheckCircle2
              className="h-14 w-14 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <h2 id="checkout-title" className="text-xl font-bold">
              Pedido confirmado!
            </h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">Número do pedido</p>
            <p className="rounded-xl bg-stone-100 px-4 py-2 font-mono text-2xl font-bold tracking-widest dark:bg-stone-800">
              #{orderNumber(done.orderId)}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-stone-700 dark:text-stone-200">
              <Clock className="h-4 w-4" aria-hidden />
              Chega em cerca de {done.estimatedMinutes} min
            </p>
            <p className="text-sm text-stone-700 dark:text-stone-200">
              Total: {formatBRL(done.totalCents)}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Pedido simulado: nenhum pagamento ou entrega real acontece.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-2 h-11 w-full rounded-xl bg-brand-700 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <h2 id="checkout-title" className="pr-8 text-xl font-bold">
              Confirmar pedido
            </h2>
            {cart && cart.items.length > 0 ? (
              <>
                {cart.restaurant && (
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    <span aria-hidden>{cart.restaurant.emoji}</span> {cart.restaurant.name} ·{' '}
                    {cart.restaurant.deliveryMinMinutes}–{cart.restaurant.deliveryMaxMinutes} min
                  </p>
                )}
                <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto text-sm">
                  {cart.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span>
                        {item.quantity}× {item.name}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatBRL(item.lineTotalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 space-y-1.5 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
                  <div className="flex justify-between text-stone-600 dark:text-stone-300">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">{formatBRL(cart.subtotalCents)}</dd>
                  </div>
                  <div className="flex justify-between text-stone-600 dark:text-stone-300">
                    <dt>Entrega</dt>
                    <dd className="tabular-nums">
                      {cart.deliveryFeeCents === 0 ? 'Grátis' : formatBRL(cart.deliveryFeeCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between text-base font-bold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{formatBRL(cart.totalCents)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-300">
                Seu carrinho está vazio.
              </p>
            )}
            {checkout.isError && (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {errorText(checkout.error, cart?.missingForMinOrderCents ?? 0)}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={close}
                className="h-11 rounded-xl border border-stone-300 px-5 text-sm font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => checkout.mutate()}
                disabled={checkout.isPending || !cart || cart.items.length === 0}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                {checkout.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Confirmar pedido
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
