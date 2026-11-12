import {
  addCartItemSchema,
  chatEventSchema,
  chatRequestSchema,
  searchDishesQuerySchema,
  updateCartItemSchema,
} from './index';

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

describe('chat schemas', () => {
  it('trims the message and enforces 1 to 500 characters', () => {
    expect(chatRequestSchema.parse({ message: '  oi  ' }).message).toBe('oi');
    expect(chatRequestSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: 'x'.repeat(501) }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: 'x'.repeat(500) }).success).toBe(true);
  });

  it('accepts only uuid conversation ids', () => {
    expect(chatRequestSchema.safeParse({ message: 'oi', conversationId: 'abc' }).success).toBe(
      false,
    );
    expect(
      chatRequestSchema.safeParse({
        message: 'oi',
        conversationId: '3b241101-e2bb-4255-8caf-4136c566a962',
      }).success,
    ).toBe(true);
  });

  it('discriminates events by type', () => {
    expect(chatEventSchema.safeParse({ type: 'token', data: { text: 'a' } }).success).toBe(true);
    expect(chatEventSchema.safeParse({ type: 'token', data: {} }).success).toBe(false);
    expect(chatEventSchema.safeParse({ type: 'nope', data: {} }).success).toBe(false);
    expect(
      chatEventSchema.safeParse({ type: 'error', data: { code: 'LLM_ERROR', message: 'x' } })
        .success,
    ).toBe(true);
  });
});
