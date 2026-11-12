import { createHash } from 'node:crypto';
import { type DietaryTag, type Allergen } from '@garfo/shared';
import { type Dish, type Restaurant } from '@prisma/client';
import { FakeEmbeddingProvider } from '../llm/fake-embedding.provider';
import { type PrismaService } from '../prisma/prisma.service';
import { connectOrSkip, createPrisma, whenDb } from '../testing/db';
import { SearchService, type SearchParams } from './search.service';

/**
 * Integration tests against the real Postgres, with the fake embedding provider.
 * They only READ embeddings (D2.10): the local database may hold paid, real ones.
 */
describe('SearchService (integration)', () => {
  let prisma: PrismaService;
  let ready = false;
  let service: SearchService;
  let byId: Map<string, Dish & { restaurant: Restaurant }>;
  let allEmbeddedWithFake = false;
  const closedSlug = `test-closed-${Date.now()}`;
  let closedDishId: string;

  beforeAll(async () => {
    prisma = createPrisma();
    ready = await connectOrSkip(prisma);
    if (!ready) return;
    service = new SearchService(prisma, new FakeEmbeddingProvider());
    const dishes = await prisma.dish.findMany({ include: { restaurant: true } });
    byId = new Map(dishes.map((dish) => [dish.id, dish]));

    const rows = await prisma.$queryRaw<Array<{ id: string; text: string; hash: string | null }>>`
      SELECT id, "embeddingText" AS text, "embeddingHash" AS hash FROM "Dish"`;
    allEmbeddedWithFake =
      rows.length > 0 &&
      rows.every(
        (row) =>
          row.hash === createHash('sha256').update(`fake-lexical-v1\n${row.text}`).digest('hex'),
      );

    // A closed restaurant with an available dish (no embedding): must never be returned.
    const restaurant = await prisma.restaurant.create({
      data: {
        slug: closedSlug,
        name: 'Fechado Teste',
        cuisine: 'teste',
        description: 'Restaurante fechado de teste',
        emoji: '🚪',
        rating: 5,
        deliveryFeeCents: 100,
        deliveryMinMinutes: 10,
        deliveryMaxMinutes: 10,
        minOrderCents: 100,
        isOpen: false,
      },
    });
    const dish = await prisma.dish.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Prato do restaurante fechado',
        description: 'Nunca deve aparecer',
        priceCents: 800,
        category: 'MAIN',
        dietaryTags: ['vegetarian'],
        allergens: [],
        embeddingText: 'Prato do restaurante fechado',
      },
    });
    closedDishId = dish.id;
  });

  afterAll(async () => {
    if (ready) {
      await prisma.dish.deleteMany({ where: { restaurant: { slug: closedSlug } } });
      await prisma.restaurant.deleteMany({ where: { slug: closedSlug } });
    }
    await prisma?.$disconnect();
  });

  function expectAllRespect(
    results: Awaited<ReturnType<SearchService['search']>>,
    p: SearchParams,
  ) {
    const limit = p.limit ?? 8;
    expect(results.length).toBeLessThanOrEqual(limit);
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
    for (const result of results) {
      const row = byId.get(result.id);
      expect(row).toBeDefined();
      if (!row) continue;
      expect(row.available).toBe(true);
      expect(row.restaurant.isOpen).toBe(true);
      if (p.maxPriceCents !== undefined)
        expect(row.priceCents).toBeLessThanOrEqual(p.maxPriceCents);
      for (const tag of p.dietaryTags ?? []) expect(row.dietaryTags).toContain(tag);
      for (const allergen of p.excludeAllergens ?? [])
        expect(row.allergens).not.toContain(allergen);
      if (p.maxDeliveryMinutes !== undefined) {
        expect(row.restaurant.deliveryMaxMinutes).toBeLessThanOrEqual(p.maxDeliveryMinutes);
      }
      if (p.category) expect(row.category).toBe(p.category);
      if (p.restaurantSlug) expect(row.restaurant.slug).toBe(p.restaurantSlug);
      expect(result.restaurant.slug).toBe(row.restaurant.slug);
      if (p.q) {
        expect(result.score).not.toBeNull();
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      } else {
        expect(result.score).toBeNull();
      }
    }
  }

  const combos: Array<[string, SearchParams]> = [
    ['no filters', { limit: 20 }],
    ['max price', { maxPriceCents: 3000, limit: 20 }],
    [
      'vegetarian + price',
      { dietaryTags: ['vegetarian'] as DietaryTag[], maxPriceCents: 4000, limit: 20 },
    ],
    ['vegan + gluten free', { dietaryTags: ['vegan', 'gluten_free'] as DietaryTag[], limit: 20 }],
    ['excluded allergens', { excludeAllergens: ['gluten', 'lactose'] as Allergen[], limit: 20 }],
    [
      'tags + allergens + time + price',
      {
        dietaryTags: ['vegan', 'gluten_free'] as DietaryTag[],
        excludeAllergens: ['soy'] as Allergen[],
        maxDeliveryMinutes: 40,
        maxPriceCents: 6000,
        limit: 20,
      },
    ],
    ['delivery time', { maxDeliveryMinutes: 30, limit: 20 }],
    ['category', { category: 'DESSERT', limit: 20 }],
    [
      'category + tags',
      {
        category: 'MAIN',
        dietaryTags: ['lactose_free'] as DietaryTag[],
        limit: 20,
      },
    ],
    ['restaurant', { restaurantSlug: 'raiz-verde', limit: 20 }],
    ['limit 3', { limit: 3 }],
    ['impossible', { dietaryTags: ['vegan'] as DietaryTag[], maxPriceCents: 100, limit: 20 }],
  ];

  describe.each(combos)('filters: %s', (_name, params) => {
    it(
      'without q: every result respects every filter',
      whenDb(
        () => ready,
        async () => {
          expectAllRespect(await service.search(params), params);
        },
      ),
    );

    it(
      'with q: every result respects every filter',
      whenDb(
        () => ready,
        async () => {
          const withQ = { ...params, q: 'vegetariano barato' };
          expectAllRespect(await service.search(withQ), withQ);
        },
      ),
    );
  });

  it(
    'without q, orders by restaurant rating desc then price asc',
    whenDb(
      () => ready,
      async () => {
        const results = await service.search({ limit: 20 });
        const rows = results
          .map((r) => byId.get(r.id))
          .filter((r): r is NonNullable<typeof r> => !!r);
        for (let i = 1; i < rows.length; i += 1) {
          const [prev, cur] = [rows[i - 1], rows[i]];
          if (!prev || !cur) continue;
          expect(prev.restaurant.rating).toBeGreaterThanOrEqual(cur.restaurant.rating);
          if (prev.restaurant.rating === cur.restaurant.rating) {
            expect(prev.priceCents).toBeLessThanOrEqual(cur.priceCents);
          }
        }
      },
    ),
  );

  it(
    'never returns unavailable dishes or dishes from closed restaurants',
    whenDb(
      () => ready,
      async () => {
        const unavailable = [...byId.values()].filter((d) => !d.available).map((d) => d.id);
        expect(unavailable.length).toBeGreaterThan(0);
        for (const q of [undefined, 'kombucha', 'prato fechado']) {
          const results = await service.search({ q, limit: 20 });
          const ids = results.map((r) => r.id);
          for (const id of [...unavailable, closedDishId]) expect(ids).not.toContain(id);
        }
        expect(await service.search({ restaurantSlug: closedSlug })).toEqual([]);
      },
    ),
  );

  it(
    'with fake embeddings in the database, ranks by relevance (desc scores, relevant top hit)',
    whenDb(
      () => ready,
      async () => {
        if (!allEmbeddedWithFake) {
          console.warn(
            'Database has no fake embeddings (run `pnpm db:embed` with LLM_PROVIDER=fake): ranking test skipped.',
          );
          return;
        }
        const results = await service.search({ q: 'sushi salmão', limit: 10 });
        expect(results.length).toBeGreaterThan(0);
        const scores = results.map((r) => r.score ?? -1);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        const top = results[0];
        expect(`${top?.name} ${top?.description}`.toLowerCase()).toMatch(/sushi|salm/);
      },
    ),
  );

  it(
    'caches query embeddings per normalised text',
    whenDb(
      () => ready,
      async () => {
        const provider = new FakeEmbeddingProvider();
        const spy = jest.spyOn(provider, 'embed');
        const cached = new SearchService(prisma, provider);
        await cached.search({ q: 'Pizza  Doce' });
        await cached.search({ q: 'pizza doce' });
        await cached.search({ q: 'outra coisa' });
        expect(spy).toHaveBeenCalledTimes(2);
      },
    ),
  );

  it(
    'getDish, getRestaurant and listRestaurants',
    whenDb(
      () => ready,
      async () => {
        const [first] = [...byId.values()];
        if (!first) throw new Error('no dishes');
        expect((await service.getDish(first.id)).name).toBe(first.name);
        await expect(service.getDish('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject(
          {
            code: 'DISH_NOT_FOUND',
          },
        );

        const detail = await service.getRestaurant(first.restaurant.slug);
        expect(detail.dishes.every((d) => byId.get(d.id)?.available)).toBe(true);
        await expect(service.getRestaurant('nao-existe')).rejects.toMatchObject({
          code: 'RESTAURANT_NOT_FOUND',
        });

        const list = await service.listRestaurants();
        const ratings = list.map((r) => r.rating);
        expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
      },
    ),
  );
});
