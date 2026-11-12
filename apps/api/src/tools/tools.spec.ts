import { DomainError } from '../common/domain-error';
import { type CartService } from '../cart/cart.service';
import { type SearchService } from '../catalog/search.service';
import { DISH_1, DISH_2, emptyCart, makeCart, makeDish } from '../testing/fixtures';
import { addToCartSchema, createAddToCartTool } from './add-to-cart.tool';
import { clearCartSchema, createClearCartTool } from './clear-cart.tool';
import { createGetDishTool, getDishSchema } from './get-dish.tool';
import { createGetRestaurantTool, getRestaurantSchema } from './get-restaurant.tool';
import { createSearchDishesTool, searchDishesSchema } from './search-dishes.tool';
import { collectDishRefs, formatReaisCompact, shortDescription } from './tool.format';
import { ToolRegistry } from './tool.registry';
import { createUpdateCartItemTool, updateCartItemSchema } from './update-cart-item.tool';
import { createViewCartTool, viewCartSchema } from './view-cart.tool';

const ctx = { sessionId: 's1' };
const names = new Map([[DISH_1, 'Baião de dois']]);

function stubs() {
  const search = {
    search: jest.fn(),
    getDish: jest.fn(),
    getRestaurant: jest.fn(),
  };
  const cart = {
    getCart: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    clear: jest.fn(),
  };
  return {
    search,
    cart,
    registry: (timeoutMs?: number) =>
      new ToolRegistry(
        search as unknown as SearchService,
        cart as unknown as CartService,
        timeoutMs === undefined ? undefined : { timeoutMs },
      ),
  };
}

describe('tool schemas', () => {
  it('search_dishes: valid, defaults and invalid', () => {
    expect(searchDishesSchema.parse({ query: 'pizza' }).limit).toBe(5);
    expect(
      searchDishesSchema.safeParse({
        query: 'x',
        max_price_reais: 40,
        dietary_tags: ['vegetarian'],
        exclude_allergens: ['peanut'],
        max_delivery_minutes: 30,
        category: 'DESSERT',
        restaurant_slug: 'forno-da-vila',
        limit: 8,
      }).success,
    ).toBe(true);
    for (const bad of [
      {},
      { query: 'x', limit: 9 },
      { query: 'x', limit: 0 },
      { query: 'x', dietary_tags: ['keto'] },
      { query: 'x', exclude_allergens: ['pollen'] },
      { query: 'x', category: 'SOUP' },
      { query: 'x', max_price_reais: -1 },
      { query: 'x', max_delivery_minutes: 0 },
    ]) {
      expect(searchDishesSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('get_restaurant, get_dish', () => {
    expect(getRestaurantSchema.safeParse({ slug: 'forno-da-vila' }).success).toBe(true);
    expect(getRestaurantSchema.safeParse({ slug: '' }).success).toBe(false);
    expect(getDishSchema.safeParse({ dish_id: DISH_1 }).success).toBe(true);
    expect(getDishSchema.safeParse({ dish_id: 'abc' }).success).toBe(false);
  });

  it('view_cart and clear_cart take no arguments', () => {
    expect(viewCartSchema.safeParse({}).success).toBe(true);
    expect(clearCartSchema.safeParse({}).success).toBe(true);
  });

  it('add_to_cart: quantity 1 to 10', () => {
    expect(addToCartSchema.safeParse({ dish_id: DISH_1, quantity: 10 }).success).toBe(true);
    for (const bad of [
      { dish_id: DISH_1, quantity: 0 },
      { dish_id: DISH_1, quantity: 11 },
      { dish_id: DISH_1, quantity: 1.5 },
      { dish_id: 'x', quantity: 1 },
      { dish_id: DISH_1 },
    ]) {
      expect(addToCartSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('update_cart_item: quantity 0 to 10', () => {
    expect(updateCartItemSchema.safeParse({ item_id: 'i1', quantity: 0 }).success).toBe(true);
    expect(updateCartItemSchema.safeParse({ item_id: 'i1', quantity: 11 }).success).toBe(false);
    expect(updateCartItemSchema.safeParse({ item_id: 'i1', quantity: -1 }).success).toBe(false);
    expect(updateCartItemSchema.safeParse({ quantity: 1 }).success).toBe(false);
  });
});

describe('tool labels (pt-BR)', () => {
  const { search, cart } = stubs();
  const searchTool = createSearchDishesTool(search as unknown as SearchService);
  const cartService = cart as unknown as CartService;

  it('search_dishes describes the filters', () => {
    const label = (args: unknown) => searchTool.label(searchDishesSchema.parse(args), names);
    expect(label({ query: 'x', dietary_tags: ['vegetarian'], max_price_reais: 40 })).toBe(
      'Buscando pratos vegetarianos até R$ 40…',
    );
    expect(label({ query: 'algo leve' })).toBe('Buscando "algo leve"…');
    expect(label({ query: '' })).toBe('Buscando pratos…');
    expect(
      label({
        query: 'x',
        dietary_tags: ['vegan', 'gluten_free'],
        exclude_allergens: ['peanut', 'soy'],
        max_price_reais: 32.9,
        max_delivery_minutes: 30,
      }),
    ).toBe('Buscando pratos veganos e sem glúten sem amendoim e soja até R$ 32,90 em até 30 min…');
  });

  it('cart and detail tools', () => {
    expect(createAddToCartTool(cartService).label({ dish_id: DISH_1, quantity: 2 }, names)).toBe(
      'Adicionando 2× Baião de dois ao carrinho…',
    );
    expect(createAddToCartTool(cartService).label({ dish_id: DISH_2, quantity: 1 }, names)).toBe(
      'Adicionando 1× o prato ao carrinho…',
    );
    expect(createUpdateCartItemTool(cartService).label({ item_id: 'i', quantity: 0 }, names)).toBe(
      'Removendo o item do carrinho…',
    );
    expect(createUpdateCartItemTool(cartService).label({ item_id: 'i', quantity: 3 }, names)).toBe(
      'Atualizando a quantidade para 3…',
    );
    expect(createViewCartTool(cartService).label({}, names)).toBe('Conferindo o seu carrinho…');
    expect(createClearCartTool(cartService).label({}, names)).toBe('Esvaziando o carrinho…');
    const getDish = createGetDishTool(search as unknown as SearchService);
    expect(getDish.label({ dish_id: DISH_1 }, names)).toBe(
      'Consultando detalhes de Baião de dois…',
    );
    expect(getDish.label({ dish_id: DISH_2 }, names)).toBe('Consultando detalhes do prato…');
    expect(
      createGetRestaurantTool(search as unknown as SearchService).label(
        { slug: 'forno-da-vila' },
        names,
      ),
    ).toBe('Consultando o cardápio de forno da vila…');
  });
});

describe('tool results', () => {
  it('search_dishes converts reais to cents and returns compact results', async () => {
    const { search, registry } = stubs();
    search.search.mockResolvedValue([
      makeDish({ description: 'x'.repeat(300) }),
      makeDish({ id: DISH_2, name: 'Outro', score: null }),
    ]);
    const out = await registry().execute(
      'search_dishes',
      JSON.stringify({ query: 'baião', max_price_reais: 32.9, dietary_tags: ['vegetarian'] }),
      ctx,
    );

    expect(search.search).toHaveBeenCalledWith({
      q: 'baião',
      maxPriceCents: 3290,
      dietaryTags: ['vegetarian'],
      excludeAllergens: undefined,
      maxDeliveryMinutes: undefined,
      category: undefined,
      restaurantSlug: undefined,
      limit: 5,
    });
    expect(out.ok).toBe(true);
    const result = out.result as { count: number; results: Array<Record<string, unknown>> };
    expect(result.count).toBe(2);
    expect(result.results[0]).toMatchObject({
      id: DISH_1,
      price: 'R$ 32,90',
      priceCents: 3290,
      delivery: '40-60 min',
    });
    expect((result.results[0]?.description as string).length).toBeLessThanOrEqual(120);
    expect([...out.dishes.keys()]).toEqual([DISH_1, DISH_2]);
  });

  it('search_dishes with an empty query searches by filters only', async () => {
    const { search, registry } = stubs();
    search.search.mockResolvedValue([]);
    await registry().execute('search_dishes', JSON.stringify({ query: '' }), ctx);
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  it('get_restaurant and get_dish expose the dishes seen', async () => {
    const { search, registry } = stubs();
    search.getRestaurant.mockResolvedValue({
      slug: 'sertao-arretado',
      name: 'Sertão Arretado',
      cuisine: 'Nordestina',
      description: '',
      emoji: '🌵',
      rating: 4.8,
      deliveryFeeCents: 500,
      deliveryMinMinutes: 40,
      deliveryMaxMinutes: 60,
      minOrderCents: 2500,
      isOpen: true,
      id: 'r1',
      dishes: [makeDish()],
    });
    const menu = await registry().execute('get_restaurant', '{"slug":"sertao-arretado"}', ctx);
    expect(menu.ok).toBe(true);
    expect(menu.dishes.get(DISH_1)).toBe('Baião de dois');

    search.getDish.mockResolvedValue(makeDish());
    const dish = await registry().execute('get_dish', JSON.stringify({ dish_id: DISH_1 }), ctx);
    expect(dish.result).toMatchObject({ id: DISH_1, allergens: ['lactose'], calories: 650 });
  });

  it('cart tools return the cart for cart_updated and a compact view for the model', async () => {
    const { cart, registry } = stubs();
    const full = makeCart();
    cart.getCart.mockResolvedValue(full);
    cart.addItem.mockResolvedValue(full);
    cart.updateItem.mockResolvedValue(full);
    cart.clear.mockResolvedValue(emptyCart());

    const view = await registry().execute('view_cart', '', ctx);
    expect(view.cart).toBeUndefined();
    expect(view.result).toMatchObject({
      cart: { total: 'R$ 70,80', items: [{ itemId: 'item-1' }] },
    });
    expect(view.dishes.size).toBe(0);

    const added = await registry().execute(
      'add_to_cart',
      JSON.stringify({ dish_id: DISH_1, quantity: 2, notes: 'sem cebola' }),
      ctx,
    );
    expect(cart.addItem).toHaveBeenCalledWith('s1', {
      dishId: DISH_1,
      quantity: 2,
      notes: 'sem cebola',
    });
    expect(added.cart).toEqual(full);
    expect(added.result).toMatchObject({ added: { name: 'Baião de dois', quantity: 2 } });

    const updated = await registry().execute(
      'update_cart_item',
      JSON.stringify({ item_id: 'item-1', quantity: 1 }),
      ctx,
    );
    expect(cart.updateItem).toHaveBeenCalledWith('s1', 'item-1', 1);
    expect(updated.cart).toEqual(full);

    const cleared = await registry().execute('clear_cart', '{}', ctx);
    expect(cleared.cart?.items).toEqual([]);
  });
});

describe('ToolRegistry', () => {
  it('lists the 7 tools with OpenAI-friendly JSON Schemas', () => {
    const definitions = stubs().registry().definitions();
    expect(definitions.map((d) => d.name)).toEqual([
      'search_dishes',
      'get_restaurant',
      'get_dish',
      'view_cart',
      'add_to_cart',
      'update_cart_item',
      'clear_cart',
    ]);
    for (const definition of definitions) {
      expect(definition.description.length).toBeGreaterThan(40);
      expect(definition.parameters).not.toHaveProperty('$schema');
      expect(definition.parameters.type).toBe('object');
      expect(JSON.stringify(definition.parameters)).not.toContain('$ref');
    }
    const search = definitions[0]?.parameters as {
      required: string[];
      properties: Record<string, { type?: string; enum?: string[]; items?: { enum: string[] } }>;
    };
    expect(search.required).toEqual(['query']);
    expect(search.properties.max_price_reais?.type).toBe('number');
    expect(search.properties.dietary_tags?.items?.enum).toContain('vegetarian');
  });

  it('turns invalid or malformed arguments into a VALIDATION_ERROR result', async () => {
    const { search, registry } = stubs();
    for (const argsJson of ['{not json', '{"limit":99}', '[]', '"x"']) {
      const out = await registry().execute('search_dishes', argsJson, ctx);
      expect(out.ok).toBe(false);
      expect(out.result).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    const out = await registry().execute('search_dishes', '{"query":"x","limit":99}', ctx);
    expect((out.result as { error: { message: string } }).error.message).toContain('limit');
    expect(search.search).not.toHaveBeenCalled();
  });

  it('rejects unknown tools as a result, not an exception', async () => {
    const out = await stubs().registry().execute('drop_tables', '{}', ctx);
    expect(out).toMatchObject({ ok: false, result: { error: { code: 'VALIDATION_ERROR' } } });
  });

  it('converts DomainError into an error result with details', async () => {
    const { cart, registry } = stubs();
    cart.addItem.mockRejectedValue(
      new DomainError('DIFFERENT_RESTAURANT', 'Seu carrinho é do Forno da Vila.', { a: 1 }),
    );
    const out = await registry().execute(
      'add_to_cart',
      JSON.stringify({ dish_id: DISH_1, quantity: 1 }),
      ctx,
    );
    expect(out).toMatchObject({
      ok: false,
      result: {
        error: {
          code: 'DIFFERENT_RESTAURANT',
          message: 'Seu carrinho é do Forno da Vila.',
          details: { a: 1 },
        },
      },
    });
    expect(out.cart).toBeUndefined();
  });

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const { search, registry } = stubs();
    search.search.mockRejectedValue(new Error('connection refused to 10.0.0.5'));
    const out = await registry().execute('search_dishes', '{"query":"x"}', ctx);
    expect(out.result).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(out.result)).not.toContain('10.0.0.5');
  });

  it('answers TOOL_TIMEOUT when a handler takes too long', async () => {
    const { search, registry } = stubs();
    search.search.mockImplementation(() => new Promise(() => undefined));
    const out = await registry(20).execute('search_dishes', '{"query":"x"}', ctx);
    expect(out).toMatchObject({ ok: false, result: { error: { code: 'TOOL_TIMEOUT' } } });
  });

  it('labels with a safe fallback for bad arguments', () => {
    const registry = stubs().registry();
    expect(registry.label('search_dishes', '{"limit":99}', names)).toBe('Processando o pedido…');
    expect(registry.label('nope', '{}', names)).toBe('Processando o pedido…');
    expect(
      registry.label('add_to_cart', JSON.stringify({ dish_id: DISH_1, quantity: 2 }), names),
    ).toBe('Adicionando 2× Baião de dois ao carrinho…');
  });
});

describe('tool.format helpers', () => {
  it('shortens long descriptions with an ellipsis', () => {
    expect(shortDescription('curta')).toBe('curta');
    const long = shortDescription('a'.repeat(200));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('collects dishes from nested results but not cart lines', () => {
    const found = collectDishRefs({
      results: [{ id: DISH_1, name: 'A', priceCents: 1 }],
      cart: { items: [{ itemId: 'i', dishId: DISH_2, name: 'B' }] },
      other: { id: 'x', name: 'no price' },
    });
    expect([...found.entries()]).toEqual([[DISH_1, 'A']]);
  });

  it('formats prices for labels', () => {
    expect(formatReaisCompact(40)).toBe('R$ 40');
    expect(formatReaisCompact(32.9)).toBe('R$ 32,90');
  });
});
