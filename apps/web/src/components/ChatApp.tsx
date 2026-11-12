'use client';

import { ShoppingBag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useCartSync, useIsDemoMode } from '@/lib/queries';
import { useCartStore } from '@/stores/cart.store';
import { useChatStore } from '@/stores/chat.store';
import { CartDrawer } from './CartDrawer';
import { CartPanel } from './CartPanel';
import { ChatWindow } from './ChatWindow';
import { CheckoutDialog } from './CheckoutDialog';
import { Header } from './Header';

export function ChatApp() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const itemCount = useCartStore((s) => s.cart?.itemCount ?? 0);
  const reset = useChatStore((s) => s.reset);
  const demo = useIsDemoMode();
  useCartSync();

  useEffect(() => {
    void useChatStore.getState().hydrate();
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closeCheckout = useCallback(() => setCheckoutOpen(false), []);
  const startCheckout = useCallback(() => {
    setDrawerOpen(false);
    setCheckoutOpen(true);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <Header onNewChat={reset} />
      {demo && (
        <p
          role="status"
          className="shrink-0 border-b border-brand-200 bg-brand-50 px-4 py-1.5 text-center text-xs text-brand-900 dark:border-brand-900/60 dark:bg-brand-900/40 dark:text-brand-200"
        >
          Modo demonstração: respostas roteirizadas, sem IA real.
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <ChatWindow />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Abrir carrinho, ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`}
            className="absolute bottom-28 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-900/30 transition-transform hover:bg-brand-800 active:scale-95 lg:hidden"
          >
            <ShoppingBag className="h-6 w-6" aria-hidden />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-900 px-1.5 text-xs font-bold ring-2 ring-stone-50 dark:bg-stone-50 dark:text-stone-900 dark:ring-stone-950">
                {itemCount}
              </span>
            )}
          </button>
        </main>
        <aside
          aria-label="Carrinho"
          className="hidden w-[360px] shrink-0 flex-col border-l border-stone-200 bg-stone-50/60 lg:flex dark:border-stone-800 dark:bg-stone-900/40"
        >
          <CartPanel onCheckout={startCheckout} />
        </aside>
      </div>
      <CartDrawer open={drawerOpen} onClose={closeDrawer} onCheckout={startCheckout} />
      <CheckoutDialog open={checkoutOpen} onClose={closeCheckout} />
    </div>
  );
}
