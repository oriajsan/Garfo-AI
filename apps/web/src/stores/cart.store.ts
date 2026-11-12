import type { Cart } from '@garfo/shared';
import { create } from 'zustand';

interface CartState {
  cart: Cart | null;
  setCart: (cart: Cart) => void;
}

/** Current cart, fed by `cart_updated` (SSE) and by every REST response. */
export const useCartStore = create<CartState>((set) => ({
  cart: null,
  setCart: (cart) => set({ cart }),
}));
