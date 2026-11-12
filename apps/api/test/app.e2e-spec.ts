import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { type NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadFixtures, type Fixtures } from '../src/testing/db';

// @scalar/nestjs-api-reference is ESM-only and cannot be loaded inside Jest's CommonJS sandbox.
// The stub serves the OpenAPI document it receives, so the test still checks the generated
// spec (swagger + nestjs-zod); the real Scalar page is checked by hand with curl/browser.
jest.mock('@scalar/nestjs-api-reference', () => ({
  apiReference:
    (options: { spec: { content: unknown } }) =>
    (_req: unknown, res: { type: (t: string) => { send: (b: string) => void } }) => {
      res.type('html').send(JSON.stringify(options.spec.content));
    },
}));

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface CartBody {
  id: string | null;
  items: Array<{ id: string; quantity: number; dishId: string }>;
  itemCount: number;
  subtotalCents: number;
  totalCents: number;
}
interface SearchBody {
  results: Array<{
    id: string;
    priceCents: number;
    dietaryTags: string[];
    allergens: string[];
    score: number | null;
    restaurant: { deliveryMaxMinutes: number };
  }>;
}

describe('Garfo API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const sessions: string[] = [];

  const session = (): string => {
    const id = randomUUID();
    sessions.push(id);
    return id;
  };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    fx = await loadFixtures(prisma);
  });

  afterAll(async () => {
    await prisma.cart.deleteMany({ where: { sessionId: { in: sessions } } });
    await app.close();
  });

  describe('health and docs', () => {
    it('GET /health', async () => {
      const res = await api().get('/api/v1/health').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        db: 'ok',
        llm: expect.stringMatching(/^(openai|fake)$/) as string,
      });
    });

    it('serves the API reference at /docs with every endpoint documented', async () => {
      const res = await api().get('/docs').expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      const paths = Object.keys((JSON.parse(res.text) as { paths: object }).paths);
      expect(paths).toEqual(
        expect.arrayContaining([
          '/api/v1/restaurants',
          '/api/v1/restaurants/{slug}',
          '/api/v1/dishes/search',
          '/api/v1/cart',
          '/api/v1/cart/items',
          '/api/v1/cart/items/{itemId}',
          '/api/v1/cart/checkout',
        ]),
      );
    });

    it('sends security headers and a JSON 404 for unknown routes', async () => {
      const res = await api().get('/api/v1/nope').expect(404);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
    });

    it('rejects JSON bodies above 10 kB', async () => {
      const res = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', session())
        .send({ dishId: fx.dishA.id, quantity: 1, notes: 'x'.repeat(11_000) })
        .expect(413);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('catalog', () => {
    it('lists restaurants by rating without dishes', async () => {
      const res = await api().get('/api/v1/restaurants').expect(200);
      const list = res.body as Array<{ rating: number; dishes?: unknown }>;
      expect(list).toHaveLength(6);
      expect(list[0]?.dishes).toBeUndefined();
      const ratings = list.map((r) => r.rating);
      expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
    });

    it('returns a restaurant with its available dishes or 404', async () => {
      const slug = fx.dishA.restaurant.slug;
      const res = await api().get(`/api/v1/restaurants/${slug}`).expect(200);
      const detail = res.body as { slug: string; dishes: Array<{ id: string }> };
      expect(detail.slug).toBe(slug);
      expect(detail.dishes.length).toBeGreaterThan(0);
      expect(detail.dishes.map((d) => d.id)).not.toContain(fx.unavailable.id);

      const missing = await api().get('/api/v1/restaurants/nao-existe').expect(404);
      expect((missing.body as ErrorBody).error.code).toBe('RESTAURANT_NOT_FOUND');
    });

    it('searches with filters over HTTP', async () => {
      const res = await api()
        .get('/api/v1/dishes/search')
        .query({
          dietaryTags: 'vegan,gluten_free',
          excludeAllergens: 'soy',
          maxDeliveryMinutes: 40,
          maxPriceCents: 6000,
        })
        .expect(200);
      const { results } = res.body as SearchBody;
      expect(results.length).toBeGreaterThan(0);
      for (const dish of results) {
        expect(dish.dietaryTags).toEqual(expect.arrayContaining(['vegan', 'gluten_free']));
        expect(dish.allergens).not.toContain('soy');
        expect(dish.restaurant.deliveryMaxMinutes).toBeLessThanOrEqual(40);
        expect(dish.priceCents).toBeLessThanOrEqual(6000);
        expect(dish.score).toBeNull();
      }
    });

    it('returns a score when q is given', async () => {
      const res = await api()
        .get('/api/v1/dishes/search')
        .query({ q: 'vegetariano barato', dietaryTags: 'vegetarian', maxPriceCents: 4000 })
        .expect(200);
      for (const dish of (res.body as SearchBody).results) {
        expect(dish.dietaryTags).toContain('vegetarian');
        expect(dish.priceCents).toBeLessThanOrEqual(4000);
        expect(typeof dish.score).toBe('number');
      }
    });

    it.each([
      ['unknown tag', { dietaryTags: 'xyz' }],
      ['limit above 20', { limit: 50 }],
      ['limit below 1', { limit: 0 }],
      ['unknown allergen', { excludeAllergens: 'gluten,poeira' }],
      ['bad category', { category: 'SOUP' }],
      ['bad price', { maxPriceCents: 'caro' }],
    ])('rejects invalid search params: %s', async (_name, query) => {
      const res = await api().get('/api/v1/dishes/search').query(query).expect(400);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toContain('at ');
    });
  });

  describe('cart', () => {
    it('requires a valid X-Session-Id', async () => {
      for (const header of [undefined, 'not-a-uuid']) {
        const req = api().get('/api/v1/cart');
        if (header) req.set('X-Session-Id', header);
        const res = await req.expect(400);
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('starts empty, adds, sums, updates and removes items', async () => {
      const sid = session();
      const empty = await api().get('/api/v1/cart').set('X-Session-Id', sid).expect(200);
      expect((empty.body as CartBody).id).toBeNull();

      const added = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 1 })
        .expect(201);
      expect((added.body as CartBody).items).toHaveLength(1);

      const summed = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 2 })
        .expect(201);
      const body = summed.body as CartBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.quantity).toBe(3);

      const itemId = body.items[0]?.id as string;
      const patched = await api()
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('X-Session-Id', sid)
        .send({ quantity: 5 })
        .expect(200);
      expect((patched.body as CartBody).items[0]?.quantity).toBe(5);

      const removed = await api()
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('X-Session-Id', sid)
        .send({ quantity: 0 })
        .expect(200);
      expect((removed.body as CartBody).items).toEqual([]);

      const missing = await api()
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('X-Session-Id', sid)
        .send({ quantity: 1 })
        .expect(404);
      expect((missing.body as ErrorBody).error.code).toBe('CART_ITEM_NOT_FOUND');
    });

    it('validates bodies', async () => {
      const sid = session();
      for (const body of [
        { dishId: fx.dishA.id, quantity: 11 },
        { dishId: fx.dishA.id, quantity: 0 },
        { dishId: 'x', quantity: 1 },
        {},
      ]) {
        const res = await api()
          .post('/api/v1/cart/items')
          .set('X-Session-Id', sid)
          .send(body)
          .expect(400);
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects a second restaurant with 409 DIFFERENT_RESTAURANT', async () => {
      const sid = session();
      await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 1 })
        .expect(201);
      const res = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishB.id, quantity: 1 })
        .expect(409);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('DIFFERENT_RESTAURANT');
      expect(body.error.message).toContain(fx.dishA.restaurant.name);
    });

    it('rejects an unavailable dish with 409 DISH_UNAVAILABLE and unknown with 404', async () => {
      const sid = session();
      const res = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.unavailable.id, quantity: 1 })
        .expect(409);
      expect((res.body as ErrorBody).error.code).toBe('DISH_UNAVAILABLE');

      const unknown = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: randomUUID(), quantity: 1 })
        .expect(404);
      expect((unknown.body as ErrorBody).error.code).toBe('DISH_NOT_FOUND');
    });

    it('rejects summing above 10 units with 400', async () => {
      const sid = session();
      await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 9 })
        .expect(201);
      const res = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 2 })
        .expect(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('DELETE /cart empties the cart', async () => {
      const sid = session();
      await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.dishA.id, quantity: 2 })
        .expect(201);
      const res = await api().delete('/api/v1/cart').set('X-Session-Id', sid).expect(200);
      expect((res.body as CartBody).items).toEqual([]);
      expect((res.body as CartBody).totalCents).toBe(0);
    });

    it('checkout: empty cart is 422 CART_EMPTY', async () => {
      const res = await api()
        .post('/api/v1/cart/checkout')
        .set('X-Session-Id', session())
        .expect(422);
      expect((res.body as ErrorBody).error.code).toBe('CART_EMPTY');
    });

    it('checkout: below the minimum is 422 BELOW_MIN_ORDER with the missing amount', async () => {
      const sid = session();
      await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: fx.belowMin.id, quantity: 1 })
        .expect(201);
      const res = await api().post('/api/v1/cart/checkout').set('X-Session-Id', sid).expect(422);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('BELOW_MIN_ORDER');
      expect(body.error.details).toEqual({
        missingCents: fx.belowMin.restaurant.minOrderCents - fx.belowMin.priceCents,
      });
    });

    it('checkout: success closes the cart and the next GET /cart is empty', async () => {
      const sid = session();
      const { dish, quantity } = fx.meetsMin;
      const cart = await api()
        .post('/api/v1/cart/items')
        .set('X-Session-Id', sid)
        .send({ dishId: dish.id, quantity })
        .expect(201);
      const res = await api().post('/api/v1/cart/checkout').set('X-Session-Id', sid).expect(200);
      expect(res.body).toEqual({
        orderId: (cart.body as CartBody).id,
        totalCents: (cart.body as CartBody).totalCents,
        estimatedMinutes: dish.restaurant.deliveryMaxMinutes,
      });

      const after = await api().get('/api/v1/cart').set('X-Session-Id', sid).expect(200);
      expect(after.body).toMatchObject({ id: null, items: [], itemCount: 0 });
    });
  });
});
