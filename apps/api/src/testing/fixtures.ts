import { type Cart, type DishResult } from '@garfo/shared';

export const DISH_1 = '11111111-1111-4111-8111-111111111111';
export const DISH_2 = '22222222-2222-4222-8222-222222222222';
export const DISH_3 = '33333333-3333-4333-8333-333333333333';
export const UNKNOWN_DISH = '99999999-9999-4999-8999-999999999999';

export function makeDish(overrides: Partial<DishResult> = {}): DishResult {
  return {
    id: DISH_1,
    name: 'Baião de dois',
    description: 'Arroz, feijão de corda e queijo coalho.',
    priceCents: 3290,
    category: 'MAIN',
    dietaryTags: ['vegetarian'],
    allergens: ['lactose'],
    calories: 650,
    serves: 1,
    restaurant: {
      slug: 'sertao-arretado',
      name: 'Sertão Arretado',
      emoji: '🌵',
      deliveryMinMinutes: 40,
      deliveryMaxMinutes: 60,
    },
    score: 0.8,
    ...overrides,
  };
}

export function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-1',
    status: 'OPEN',
    restaurant: {
      slug: 'sertao-arretado',
      name: 'Sertão Arretado',
      emoji: '🌵',
      deliveryFeeCents: 500,
      minOrderCents: 2500,
      deliveryMinMinutes: 40,
      deliveryMaxMinutes: 60,
    },
    items: [
      {
        id: 'item-1',
        dishId: DISH_1,
        name: 'Baião de dois',
        priceCents: 3290,
        quantity: 2,
        notes: null,
        lineTotalCents: 6580,
      },
    ],
    itemCount: 2,
    subtotalCents: 6580,
    deliveryFeeCents: 500,
    totalCents: 7080,
    minOrderCents: 2500,
    missingForMinOrderCents: 0,
    ...overrides,
  };
}

export const emptyCart = (): Cart =>
  makeCart({
    id: null,
    restaurant: null,
    items: [],
    itemCount: 0,
    subtotalCents: 0,
    deliveryFeeCents: 0,
    totalCents: 0,
    minOrderCents: 0,
  });
