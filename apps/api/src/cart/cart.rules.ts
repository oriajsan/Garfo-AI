import { formatBRL, MAX_ITEM_QUANTITY, type Cart } from '@garfo/shared';
import { DomainError } from '../common/domain-error';

/**
 * Pure cart rules (SPEC section 5): no database, no Nest. They throw `DomainError` so the
 * service stays a thin layer of queries around them.
 */

export interface RestaurantInfo {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  isOpen: boolean;
  deliveryFeeCents: number;
  minOrderCents: number;
  deliveryMinMinutes: number;
  deliveryMaxMinutes: number;
}

export interface DishInfo {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  restaurantId: string;
}

/** A closed restaurant makes its dishes unavailable too (D2.6). */
export function assertDishAvailable(dish: DishInfo, restaurant: RestaurantInfo): void {
  if (!dish.available || !restaurant.isOpen) {
    throw new DomainError('DISH_UNAVAILABLE', `"${dish.name}" não está disponível no momento.`, {
      dishId: dish.id,
    });
  }
}

/** All items must come from one restaurant; `current` is null for an empty cart. */
export function assertSameRestaurant(
  current: { id: string; name: string } | null,
  dishRestaurantId: string,
): void {
  if (current && current.id !== dishRestaurantId) {
    throw new DomainError(
      'DIFFERENT_RESTAURANT',
      `Seu carrinho já tem itens de ${current.name}. Finalize o pedido ou esvazie o carrinho para pedir de outro restaurante.`,
      { currentRestaurantName: current.name },
    );
  }
}

/** New quantity when adding to an existing line (D2.6: above 10 is an error, not truncation). */
export function mergeQuantity(existing: number, added: number): number {
  const total = existing + added;
  if (added < 1 || total > MAX_ITEM_QUANTITY) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Quantidade inválida: o máximo de ${MAX_ITEM_QUANTITY} unidades por item.`,
    );
  }
  return total;
}

export interface Line {
  priceCents: number;
  quantity: number;
}

export interface Totals {
  itemCount: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  minOrderCents: number;
  missingForMinOrderCents: number;
}

/** Subtotal, fee and total; an empty cart costs nothing and has no minimum (D2.9). */
export function calculateTotals(
  lines: Line[],
  fees: { deliveryFeeCents: number; minOrderCents: number },
): Totals {
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (itemCount === 0) {
    return {
      itemCount: 0,
      subtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      minOrderCents: 0,
      missingForMinOrderCents: 0,
    };
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
  return {
    itemCount,
    subtotalCents,
    deliveryFeeCents: fees.deliveryFeeCents,
    totalCents: subtotalCents + fees.deliveryFeeCents,
    minOrderCents: fees.minOrderCents,
    missingForMinOrderCents: Math.max(0, fees.minOrderCents - subtotalCents),
  };
}

/** Checkout preconditions: not empty, and subtotal reaches the restaurant's minimum. */
export function assertCanCheckout(totals: Totals): void {
  if (totals.itemCount === 0) {
    throw new DomainError('CART_EMPTY', 'Seu carrinho está vazio.');
  }
  if (totals.missingForMinOrderCents > 0) {
    throw new DomainError(
      'BELOW_MIN_ORDER',
      `Pedido mínimo de ${formatBRL(totals.minOrderCents)}: faltam ${formatBRL(totals.missingForMinOrderCents)}.`,
      { missingCents: totals.missingForMinOrderCents },
    );
  }
}

const zeroFees = { deliveryFeeCents: 0, minOrderCents: 0 };

export interface CartSnapshot {
  id: string;
  status: 'OPEN' | 'CHECKED_OUT';
  restaurant: RestaurantInfo | null;
  items: Array<{
    id: string;
    dishId: string;
    name: string;
    priceCents: number;
    quantity: number;
    notes: string | null;
  }>;
}

/** Builds the API cart (D2.9). `null` yields the virtual empty cart of D2.4. */
export function buildCart(snapshot: CartSnapshot | null): Cart {
  if (!snapshot) {
    return {
      id: null,
      status: 'OPEN',
      restaurant: null,
      items: [],
      ...calculateTotals([], zeroFees),
    };
  }
  const { restaurant, items } = snapshot;
  const totals = calculateTotals(items, restaurant ?? zeroFees);
  return {
    id: snapshot.id,
    status: snapshot.status,
    restaurant:
      restaurant && items.length > 0
        ? {
            slug: restaurant.slug,
            name: restaurant.name,
            emoji: restaurant.emoji,
            deliveryFeeCents: restaurant.deliveryFeeCents,
            minOrderCents: restaurant.minOrderCents,
            deliveryMinMinutes: restaurant.deliveryMinMinutes,
            deliveryMaxMinutes: restaurant.deliveryMaxMinutes,
          }
        : null,
    items: items.map((item) => ({
      ...item,
      lineTotalCents: item.priceCents * item.quantity,
    })),
    ...totals,
  };
}
