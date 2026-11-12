import { DomainError } from '../common/domain-error';
import {
  assertCanCheckout,
  assertDishAvailable,
  assertSameRestaurant,
  buildCart,
  calculateTotals,
  mergeQuantity,
  type DishInfo,
  type RestaurantInfo,
} from './cart.rules';

const restaurant: RestaurantInfo = {
  id: 'r1',
  slug: 'raiz-verde',
  name: 'Raiz Verde',
  emoji: '🥗',
  isOpen: true,
  deliveryFeeCents: 500,
  minOrderCents: 2000,
  deliveryMinMinutes: 25,
  deliveryMaxMinutes: 35,
};
const dish: DishInfo = {
  id: 'd1',
  name: 'Bowl',
  priceCents: 1500,
  available: true,
  restaurantId: 'r1',
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('assertDishAvailable', () => {
  it('accepts an available dish from an open restaurant', () => {
    expect(codeOf(() => assertDishAvailable(dish, restaurant))).toBeUndefined();
  });

  it('rejects unavailable dishes and closed restaurants as DISH_UNAVAILABLE', () => {
    expect(codeOf(() => assertDishAvailable({ ...dish, available: false }, restaurant))).toBe(
      'DISH_UNAVAILABLE',
    );
    expect(codeOf(() => assertDishAvailable(dish, { ...restaurant, isOpen: false }))).toBe(
      'DISH_UNAVAILABLE',
    );
  });
});

describe('assertSameRestaurant', () => {
  it('allows an empty cart or the same restaurant', () => {
    expect(codeOf(() => assertSameRestaurant(null, 'r1'))).toBeUndefined();
    expect(
      codeOf(() => assertSameRestaurant({ id: 'r1', name: 'Raiz Verde' }, 'r1')),
    ).toBeUndefined();
  });

  it('rejects another restaurant, naming the current one', () => {
    try {
      assertSameRestaurant({ id: 'r1', name: 'Raiz Verde' }, 'r2');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('DIFFERENT_RESTAURANT');
      expect((error as DomainError).message).toContain('Raiz Verde');
      expect((error as DomainError).status).toBe(409);
    }
  });
});

describe('mergeQuantity', () => {
  it('sums quantities up to 10', () => {
    expect(mergeQuantity(0, 1)).toBe(1);
    expect(mergeQuantity(3, 7)).toBe(10);
  });

  it('rejects totals above 10 and non-positive additions', () => {
    expect(codeOf(() => mergeQuantity(8, 3))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => mergeQuantity(1, 0))).toBe('VALIDATION_ERROR');
  });
});

describe('calculateTotals', () => {
  const fees = { deliveryFeeCents: 500, minOrderCents: 2000 };

  it('is all zeros for an empty cart', () => {
    expect(calculateTotals([], fees)).toEqual({
      itemCount: 0,
      subtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      minOrderCents: 0,
      missingForMinOrderCents: 0,
    });
  });

  it('adds the delivery fee and reports what is missing for the minimum', () => {
    expect(calculateTotals([{ priceCents: 1500, quantity: 1 }], fees)).toEqual({
      itemCount: 1,
      subtotalCents: 1500,
      deliveryFeeCents: 500,
      totalCents: 2000,
      minOrderCents: 2000,
      missingForMinOrderCents: 500,
    });
  });

  it('has nothing missing when the subtotal reaches the minimum', () => {
    const totals = calculateTotals(
      [
        { priceCents: 1000, quantity: 2 },
        { priceCents: 350, quantity: 1 },
      ],
      fees,
    );
    expect(totals.subtotalCents).toBe(2350);
    expect(totals.totalCents).toBe(2850);
    expect(totals.itemCount).toBe(3);
    expect(totals.missingForMinOrderCents).toBe(0);
  });
});

describe('assertCanCheckout', () => {
  const fees = { deliveryFeeCents: 500, minOrderCents: 2000 };

  it('rejects an empty cart with CART_EMPTY', () => {
    expect(codeOf(() => assertCanCheckout(calculateTotals([], fees)))).toBe('CART_EMPTY');
  });

  it('rejects below the minimum with the missing amount', () => {
    try {
      assertCanCheckout(calculateTotals([{ priceCents: 1500, quantity: 1 }], fees));
      throw new Error('should have thrown');
    } catch (error) {
      const domain = error as DomainError;
      expect(domain.code).toBe('BELOW_MIN_ORDER');
      expect(domain.details).toEqual({ missingCents: 500 });
      expect(domain.message).toContain('R$ 5,00');
      expect(domain.status).toBe(422);
    }
  });

  it('accepts when the minimum is met', () => {
    expect(
      codeOf(() => assertCanCheckout(calculateTotals([{ priceCents: 2000, quantity: 1 }], fees))),
    ).toBeUndefined();
  });
});

describe('buildCart', () => {
  it('returns the virtual empty cart for null', () => {
    const cart = buildCart(null);
    expect(cart).toMatchObject({
      id: null,
      status: 'OPEN',
      restaurant: null,
      items: [],
      itemCount: 0,
      totalCents: 0,
    });
  });

  it('builds items, line totals and restaurant details', () => {
    const cart = buildCart({
      id: 'c1',
      status: 'OPEN',
      restaurant,
      items: [{ id: 'i1', dishId: 'd1', name: 'Bowl', priceCents: 1500, quantity: 2, notes: null }],
    });
    expect(cart.restaurant).toMatchObject({ slug: 'raiz-verde', deliveryFeeCents: 500 });
    expect(cart.items[0]).toMatchObject({ lineTotalCents: 3000, quantity: 2 });
    expect(cart).toMatchObject({
      subtotalCents: 3000,
      totalCents: 3500,
      missingForMinOrderCents: 0,
    });
  });

  it('hides the restaurant of a cart without items', () => {
    const cart = buildCart({ id: 'c1', status: 'OPEN', restaurant, items: [] });
    expect(cart.restaurant).toBeNull();
    expect(cart.deliveryFeeCents).toBe(0);
  });
});
