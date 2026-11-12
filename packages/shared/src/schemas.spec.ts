import { addCartItemSchema, searchDishesQuerySchema, updateCartItemSchema } from './index';

describe('searchDishesQuerySchema', () => {
  it('applies the default limit and treats empty values as absent', () => {
    const parsed = searchDishesQuerySchema.parse({ q: '', maxPriceCents: '' });
    expect(parsed.limit).toBe(8);
    expect(parsed.q).toBeUndefined();
    expect(parsed.maxPriceCents).toBeUndefined();
  });

  it('parses csv lists, numbers and categories', () => {
    const parsed = searchDishesQuerySchema.parse({
      q: 'vegetariano barato',
      dietaryTags: 'vegan, gluten_free',
      excludeAllergens: ['soy', 'nuts'],
      maxPriceCents: '4000',
      limit: '20',
      category: 'MAIN',
    });
    expect(parsed.dietaryTags).toEqual(['vegan', 'gluten_free']);
    expect(parsed.excludeAllergens).toEqual(['soy', 'nuts']);
    expect(parsed.maxPriceCents).toBe(4000);
    expect(parsed.limit).toBe(20);
  });

  it.each([{ dietaryTags: 'xyz' }, { limit: '50' }, { limit: '0' }, { maxPriceCents: 'abc' }])(
    'rejects %p',
    (query) => {
      expect(searchDishesQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('cart body schemas', () => {
  const dishId = '46efe8c5-77aa-5d17-81ba-612470d9fe6e';

  it('validates quantity bounds', () => {
    expect(addCartItemSchema.safeParse({ dishId, quantity: 1 }).success).toBe(true);
    expect(addCartItemSchema.safeParse({ dishId, quantity: 0 }).success).toBe(false);
    expect(addCartItemSchema.safeParse({ dishId, quantity: 11 }).success).toBe(false);
    expect(addCartItemSchema.safeParse({ dishId: 'x', quantity: 1 }).success).toBe(false);
    expect(updateCartItemSchema.safeParse({ quantity: 0 }).success).toBe(true);
    expect(updateCartItemSchema.safeParse({ quantity: 1.5 }).success).toBe(false);
  });
});
