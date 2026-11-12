'use client';

import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CartPanel } from './CartPanel';
import { useModal } from './useModal';

/** Bottom sheet with the cart for screens below 1024 px. Always mounted so it can animate. */
export function CartDrawer({
  open,
  onClose,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(open, onClose, panelRef);

  // React 18 has no typed `inert` prop: toggle the attribute so a closed drawer is not focusable.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.toggleAttribute('inert', !open);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={clsx('fixed inset-0 z-40 lg:hidden', !open && 'pointer-events-none')}
      aria-hidden={!open}
    >
      <div
        className={clsx(
          'absolute inset-0 bg-stone-950/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-label="Carrinho"
        tabIndex={-1}
        className={clsx(
          'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl bg-stone-50 shadow-2xl outline-none transition-transform duration-300 ease-out dark:bg-stone-950',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div
          className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-stone-300 dark:bg-stone-700"
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar carrinho"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-800"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
          <CartPanel onCheckout={onCheckout} />
        </div>
      </div>
    </div>
  );
}
