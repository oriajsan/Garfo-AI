import { useMutation, useQuery } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cart.store';
import { api } from './api';

/** Loads the open cart once and mirrors every cart response into the zustand store. */
export function useCartSync(): void {
  const setCart = useCartStore((s) => s.setCart);
  useQuery({
    queryKey: ['cart'],
    queryFn: async () => {
      const cart = await api.getCart();
      setCart(cart);
      return cart;
    },
    refetchOnWindowFocus: false,
  });
}

/** `llm: "fake"` means demo mode (D4.2). The query fails silently: the notice is optional. */
export function useIsDemoMode(): boolean {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return data?.llm === 'fake';
}

export function useAddToCart() {
  const setCart = useCartStore((s) => s.setCart);
  return useMutation({
    mutationFn: (dishId: string) => api.addCartItem({ dishId, quantity: 1 }),
    onSuccess: setCart,
  });
}

/** D4.1: the user confirmed replacing the cart, so empty it and then add the dish. */
export function useReplaceCartAndAdd() {
  const setCart = useCartStore((s) => s.setCart);
  return useMutation({
    mutationFn: async (dishId: string) => {
      await api.clearCart();
      return api.addCartItem({ dishId, quantity: 1 });
    },
    onSuccess: setCart,
  });
}

export function useUpdateCartItem() {
  const setCart = useCartStore((s) => s.setCart);
  return useMutation({
    mutationFn: (vars: { itemId: string; quantity: number }) =>
      api.updateCartItem(vars.itemId, vars.quantity),
    onSuccess: setCart,
  });
}

export function useClearCart() {
  const setCart = useCartStore((s) => s.setCart);
  return useMutation({ mutationFn: api.clearCart, onSuccess: setCart });
}

export function useCheckout() {
  const setCart = useCartStore((s) => s.setCart);
  return useMutation({
    mutationFn: api.checkout,
    // The checked-out cart is gone; GET /cart returns the empty one.
    onSuccess: async () => setCart(await api.getCart()),
  });
}
