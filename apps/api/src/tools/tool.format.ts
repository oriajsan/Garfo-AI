import { formatBRL, type Cart, type DishBase, type DishResult } from '@garfo/shared';

const SHORT_DESCRIPTION_LENGTH = 120;

export function shortDescription(text: string): string {
  if (text.length <= SHORT_DESCRIPTION_LENGTH) return text;
  return `${text.slice(0, SHORT_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

/** Compact dish for search results: prices in cents and formatted, short description. */
export function toSearchDish(dish: DishResult) {
  return {
    id: dish.id,
    name: dish.name,
    description: shortDescription(dish.description),
    price: formatBRL(dish.priceCents),
    priceCents: dish.priceCents,
    category: dish.category,
    dietaryTags: dish.dietaryTags,
    allergens: dish.allergens,
    restaurant: { slug: dish.restaurant.slug, name: dish.restaurant.name },
    delivery: `${dish.restaurant.deliveryMinMinutes}-${dish.restaurant.deliveryMaxMinutes} min`,
    score: dish.score,
  };
}

/** Menu line for `get_restaurant`: enough to recommend, nothing more. */
export function toMenuDish(dish: DishBase) {
  return {
    id: dish.id,
    name: dish.name,
    price: formatBRL(dish.priceCents),
    priceCents: dish.priceCents,
    category: dish.category,
    dietaryTags: dish.dietaryTags,
  };
}

/**
 * Cart as the model sees it. Items use `itemId`/`dishId` (never `id`) so a cart line is not
 * mistaken for a dish when collecting the dishes seen in a conversation.
 */
export function toToolCart(cart: Cart) {
  return {
    restaurant: cart.restaurant?.name ?? null,
    items: cart.items.map((item) => ({
      itemId: item.id,
      dishId: item.dishId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: formatBRL(item.priceCents),
      lineTotal: formatBRL(item.lineTotalCents),
      notes: item.notes,
    })),
    itemCount: cart.itemCount,
    subtotal: formatBRL(cart.subtotalCents),
    subtotalCents: cart.subtotalCents,
    deliveryFee: formatBRL(cart.deliveryFeeCents),
    deliveryFeeCents: cart.deliveryFeeCents,
    total: formatBRL(cart.totalCents),
    totalCents: cart.totalCents,
    minOrder: formatBRL(cart.minOrderCents),
    minOrderCents: cart.minOrderCents,
    missingForMinOrder: formatBRL(cart.missingForMinOrderCents),
    missingForMinOrderCents: cart.missingForMinOrderCents,
  };
}

export interface DishRef {
  id: string;
  name: string;
}

/**
 * Finds the dishes inside a tool result (any object with `id`, `name` and `priceCents`).
 * Used both for the live round and to rebuild the "seen dishes" from persisted TOOL messages.
 */
export function collectDishRefs(value: unknown, found: Map<string, string> = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectDishRefs(item, found);
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      typeof record.priceCents === 'number'
    ) {
      found.set(record.id, record.name);
    }
    for (const child of Object.values(record)) collectDishRefs(child, found);
  }
  return found;
}

/** `5` -> `R$ 5`, `32.9` -> `R$ 32,90`. Used in labels, where "R$ 40,00" would be noisy. */
export function formatReaisCompact(reais: number): string {
  return Number.isInteger(reais) ? `R$ ${reais}` : formatBRL(Math.round(reais * 100));
}
