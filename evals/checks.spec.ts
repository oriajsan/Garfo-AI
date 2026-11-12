import { dishViolations, evaluateCase, type DishFacts, type Observation } from './checks';
import { type EvalCase } from './schema';

const dish = (overrides: Partial<DishFacts>): DishFacts => ({
  id: 'd1',
  name: 'Prato',
  priceCents: 3000,
  dietaryTags: ['vegetarian'],
  allergens: [],
  category: 'MAIN',
  available: true,
  restaurantOpen: true,
  deliveryMaxMinutes: 30,
  ...overrides,
});

const observation = (overrides: Partial<Observation> = {}): Observation => ({
  toolCalls: [],
  cardIdsPerReply: [[]],
  dishes: new Map(),
  cartItems: [],
  cartRestaurantIdsPerTurn: [[]],
  finalReplyText: '',
  hallucinatedIds: [],
  runErrors: [],
  ...overrides,
});

const baseCase = (expect: EvalCase['expect']): EvalCase => ({
  id: 'x',
  category: 'simple_filters',
  description: 'x',
  input: ['oi'],
  expect,
});

const failed = (c: EvalCase, o: Observation): string[] =>
  evaluateCase(c, o)
    .checks.filter((check) => !check.passed)
    .map((check) => check.name);

describe('evaluateCase', () => {
  it('passes a case with no expectations when the run completed', () => {
    expect(evaluateCase(baseCase({}), observation()).passed).toBe(true);
  });

  it('fails when the run produced error events', () => {
    expect(failed(baseCase({}), observation({ runErrors: ['LLM_ERROR: x'] }))).toEqual([
      'completed',
    ]);
  });

  it('checks required and forbidden tools', () => {
    const c = baseCase({ mustCallTools: ['search_dishes'], mustNotCallTools: ['clear_cart'] });
    expect(
      evaluateCase(c, observation({ toolCalls: [{ name: 'search_dishes', args: {} }] })).passed,
    ).toBe(true);
    expect(failed(c, observation({ toolCalls: [{ name: 'clear_cart', args: {} }] }))).toEqual([
      'mustCall:search_dishes',
      'mustNotCall:clear_cart',
    ]);
  });

  it('counts repeated calls for minToolCalls', () => {
    const c = baseCase({ minToolCalls: { add_to_cart: 2 } });
    const add = { name: 'add_to_cart', args: {} };
    expect(evaluateCase(c, observation({ toolCalls: [add, add] })).passed).toBe(true);
    expect(failed(c, observation({ toolCalls: [add] }))).toEqual(['minToolCalls:add_to_cart']);
    expect(failed(c, observation())).toEqual(['minToolCalls:add_to_cart']);
  });

  describe('toolArgs', () => {
    const c = baseCase({
      toolArgs: [
        {
          tool: 'search_dishes',
          args: { dietary_tags: { includes: 'vegetarian' }, max_price_reais: { lte: 40 } },
        },
      ],
    });
    const call = (args: unknown): Observation =>
      observation({ toolCalls: [{ name: 'search_dishes', args }] });

    it('accepts a ceiling at or below the limit (lte) and a membership (includes)', () => {
      expect(
        evaluateCase(c, call({ dietary_tags: ['vegetarian', 'light'], max_price_reais: 35 }))
          .passed,
      ).toBe(true);
      expect(
        evaluateCase(c, call({ dietary_tags: ['vegetarian'], max_price_reais: 40 })).passed,
      ).toBe(true);
    });

    it('rejects a missing tag, a higher ceiling and a missing argument', () => {
      expect(evaluateCase(c, call({ dietary_tags: ['vegan'], max_price_reais: 40 })).passed).toBe(
        false,
      );
      expect(
        evaluateCase(c, call({ dietary_tags: ['vegetarian'], max_price_reais: 41 })).passed,
      ).toBe(false);
      expect(evaluateCase(c, call({ dietary_tags: ['vegetarian'] })).passed).toBe(false);
      expect(evaluateCase(c, call(undefined)).passed).toBe(false);
    });

    it('needs all conditions in the SAME call, not spread over several', () => {
      const split = observation({
        toolCalls: [
          { name: 'search_dishes', args: { dietary_tags: ['vegetarian'] } },
          { name: 'search_dishes', args: { max_price_reais: 40 } },
        ],
      });
      expect(evaluateCase(c, split).passed).toBe(false);
    });

    it('supports gte, equals and alternatives (anyOf)', () => {
      const alt = baseCase({
        toolArgs: [
          {
            tool: 'search_dishes',
            anyOf: [
              { dietary_tags: { includes: 'gluten_free' } },
              { exclude_allergens: { includes: 'gluten' } },
            ],
          },
          { tool: 'search_dishes', args: { category: { equals: 'DESSERT' }, limit: { gte: 2 } } },
        ],
      });
      const ok = observation({
        toolCalls: [
          {
            name: 'search_dishes',
            args: { exclude_allergens: ['gluten'], category: 'DESSERT', limit: 5 },
          },
        ],
      });
      expect(evaluateCase(alt, ok).passed).toBe(true);
      const bad = observation({
        toolCalls: [{ name: 'search_dishes', args: { category: 'MAIN', limit: 1 } }],
      });
      expect(failed(alt, bad)).toEqual(['toolArgs:search_dishes', 'toolArgs:search_dishes']);
    });
  });

  describe('recommendations', () => {
    const rule = {
      maxPriceReais: 40,
      requiredTags: ['vegetarian' as const],
      excludeAllergens: ['gluten' as const],
    };
    const c = baseCase({
      recommendedDishesSatisfy: rule,
      minRecommendations: 1,
      maxRecommendations: 3,
    });

    it('passes when every card respects price, tags and allergens (checked in the database)', () => {
      const dishes = new Map([['d1', dish({})]]);
      expect(evaluateCase(c, observation({ cardIdsPerReply: [['d1']], dishes })).passed).toBe(true);
    });

    it('lists each violation: price, tag, allergen, delivery, category, availability', () => {
      const bad = dish({
        id: 'd2',
        name: 'Ruim',
        priceCents: 5000,
        dietaryTags: [],
        allergens: ['gluten'],
        available: false,
      });
      const outcome = evaluateCase(
        c,
        observation({ cardIdsPerReply: [['d2']], dishes: new Map([['d2', bad]]) }),
      );
      const detail =
        outcome.checks.find((x) => x.name === 'recommendedDishesSatisfy')?.detail ?? '';
      expect(detail).toContain('unavailable');
      expect(detail).toContain('price R$ 50,00 > R$ 40');
      expect(detail).toContain('missing tag vegetarian');
      expect(detail).toContain('contains gluten');
    });

    it('treats a card that is not in the catalog as a violation', () => {
      expect(failed(c, observation({ cardIdsPerReply: [['ghost']] }))).toContain(
        'recommendedDishesSatisfy',
      );
    });

    it('requires at least minRecommendations and at most maxRecommendations per reply', () => {
      expect(failed(c, observation())).toEqual(['minRecommendations']);
      const many = observation({
        cardIdsPerReply: [['a', 'b', 'c', 'd']],
        dishes: new Map(['a', 'b', 'c', 'd'].map((id) => [id, dish({ id })])),
      });
      expect(failed(c, many)).toEqual(['maxRecommendations']);
      const spread = observation({
        cardIdsPerReply: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        dishes: many.dishes,
      });
      expect(evaluateCase(c, spread).passed).toBe(true);
    });

    it('supports a zero cap for no-result and out-of-scope cases', () => {
      const none = baseCase({ maxRecommendations: 0 });
      expect(evaluateCase(none, observation()).passed).toBe(true);
      expect(failed(none, observation({ cardIdsPerReply: [['a']] }))).toEqual([
        'maxRecommendations',
      ]);
    });
  });

  describe('cartAfter', () => {
    it('matches an empty cart', () => {
      const c = baseCase({ cartAfter: { empty: true } });
      expect(evaluateCase(c, observation()).passed).toBe(true);
      expect(failed(c, observation({ cartItems: [{ dishName: 'A', quantity: 1 }] }))).toEqual([
        'cartAfter',
      ]);
    });

    it('matches exact items and quantities, in any order', () => {
      const c = baseCase({
        cartAfter: {
          items: [
            { dishName: 'A', quantity: 2 },
            { dishName: 'B', quantity: 1 },
          ],
        },
      });
      const ok = observation({
        cartItems: [
          { dishName: 'B', quantity: 1 },
          { dishName: 'A', quantity: 2 },
        ],
      });
      expect(evaluateCase(c, ok).passed).toBe(true);
      const wrongQty = observation({
        cartItems: [
          { dishName: 'A', quantity: 1 },
          { dishName: 'B', quantity: 1 },
        ],
      });
      expect(evaluateCase(c, wrongQty).passed).toBe(false);
      expect(
        evaluateCase(c, observation({ cartItems: [{ dishName: 'A', quantity: 2 }] })).passed,
      ).toBe(false);
    });
  });

  it('flags hallucinated dish ids', () => {
    const c = baseCase({ noHallucinatedDishes: true });
    expect(evaluateCase(c, observation()).passed).toBe(true);
    expect(failed(c, observation({ hallucinatedIds: ['zzz'] }))).toEqual(['noHallucinatedDishes']);
  });
});

describe('restaurant conflict outcome checks', () => {
  const c = baseCase({
    mustCallTools: ['add_to_cart'],
    cartNeverMixesRestaurants: true,
    finalReplyMentions: {
      allOf: [['restaurante'], ['outro', 'diferente', 'esvaziar', 'unico']],
    },
  });
  const add = { name: 'add_to_cart', args: {} };
  const base = {
    cartItems: [{ dishName: 'A', quantity: 1 }],
    cartRestaurantIdsPerTurn: [['r1'], ['r1']],
  };

  it('passes when the second add was tried and refused', () => {
    const o = observation({
      ...base,
      toolCalls: [add, add],
      finalReplyText: 'Nao consegui: seu carrinho e de outro restaurante. Quer esvaziar?',
    });
    expect(evaluateCase(c, o).passed).toBe(true);
  });

  it('passes when the model asked before trying (single add call)', () => {
    const o = observation({
      ...base,
      toolCalls: [add],
      finalReplyText:
        'Seu carrinho tem itens de um restaurante diferente. Posso esvaziar? [[dish:x]]',
    });
    expect(evaluateCase(c, o).passed).toBe(true);
  });

  it('fails when the cart mixed restaurants in any turn, naming the turn', () => {
    const o = observation({
      ...base,
      cartRestaurantIdsPerTurn: [['r1'], ['r1', 'r2']],
      toolCalls: [add],
      finalReplyText: 'outro restaurante, esvaziar',
    });
    const result = evaluateCase(c, o);
    expect(result.checks.filter((k) => !k.passed).map((k) => k.name)).toEqual([
      'cartNeverMixesRestaurants',
    ]);
    expect(result.checks.find((k) => k.name === 'cartNeverMixesRestaurants')?.detail).toContain(
      'turn 2',
    );
  });

  it('fails when the final reply does not mention the conflict', () => {
    const o = observation({
      ...base,
      toolCalls: [add],
      finalReplyText: 'Pronto, adicionei! [[dish:x]]',
    });
    expect(failed(c, o)).toEqual(['finalReplyMentions']);
    expect(
      failed(c, observation({ ...base, toolCalls: [add], finalReplyText: 'so o restaurante' })),
    ).toEqual(['finalReplyMentions']);
  });

  it('ignores case, accents and dish markers when matching', () => {
    const o = observation({
      ...base,
      toolCalls: [add],
      finalReplyText: 'RESTAURANTE [[dish:outro]] \u00DANICO por vez',
    });
    expect(evaluateCase(c, o).passed).toBe(true);
    const onlyMarker = observation({
      ...base,
      toolCalls: [add],
      finalReplyText: 'restaurante [[dish:outro]]',
    });
    expect(failed(c, onlyMarker)).toEqual(['finalReplyMentions']);
  });
});

describe('dishViolations', () => {
  it('is empty for a dish that respects the rule, including the delivery ceiling', () => {
    expect(dishViolations(dish({}), { maxDeliveryMinutes: 30 })).toEqual([]);
    expect(
      dishViolations(dish({ deliveryMaxMinutes: 45 }), { maxDeliveryMinutes: 30 }),
    ).toHaveLength(1);
  });

  it('compares the price in integer cents, without float error', () => {
    expect(dishViolations(dish({ priceCents: 2910 }), { maxPriceReais: 29.1 })).toEqual([]);
    expect(dishViolations(dish({ priceCents: 2911 }), { maxPriceReais: 29.1 })).toHaveLength(1);
  });
});
