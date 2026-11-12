import { randomUUID } from 'node:crypto';
import { type PrismaService } from '../prisma/prisma.service';
import { connectOrSkip, createPrisma, loadFixtures, whenDb, type Fixtures } from '../testing/db';
import { CartService } from './cart.service';

/** Integration tests of the cart against the real Postgres; every test uses a fresh session. */
describe('CartService (integration)', () => {
  let prisma: PrismaService;
  let ready = false;
  let service: CartService;
  let fx: Fixtures;
  const sessions: string[] = [];

  const newSession = (): string => {
    const id = randomUUID();
    sessions.push(id);
    return id;
  };
  const run = (body: (session: string) => Promise<void>) =>
    whenDb(
      () => ready,
      () => body(newSession()),
    );

  beforeAll(async () => {
    prisma = createPrisma();
    ready = await connectOrSkip(prisma);
    if (!ready) return;
    service = new CartService(prisma);
    fx = await loadFixtures(prisma);
  });

  afterAll(async () => {
    if (ready) await prisma.cart.deleteMany({ where: { sessionId: { in: sessions } } });
    await prisma?.$disconnect();
  });

  it(
    'returns a virtual empty cart without creating a row (D2.4)',
    run(async (session) => {
      const cart = await service.getCart(session);
      expect(cart).toMatchObject({
        id: null,
        items: [],
        itemCount: 0,
        totalCents: 0,
        restaurant: null,
      });
      expect(await prisma.cart.count({ where: { sessionId: session } })).toBe(0);
    }),
  );

  it(
    'adds an item and computes subtotal, fee and total',
    run(async (session) => {
      const cart = await service.addItem(session, {
        dishId: fx.dishA.id,
        quantity: 2,
        notes: 'sem cebola',
      });
      const fee = fx.dishA.restaurant.deliveryFeeCents;
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({
        dishId: fx.dishA.id,
        quantity: 2,
        notes: 'sem cebola',
        lineTotalCents: fx.dishA.priceCents * 2,
      });
      expect(cart.restaurant?.slug).toBe(fx.dishA.restaurant.slug);
      expect(cart).toMatchObject({
        subtotalCents: fx.dishA.priceCents * 2,
        deliveryFeeCents: fee,
        totalCents: fx.dishA.priceCents * 2 + fee,
        itemCount: 2,
      });
    }),
  );

  it(
    'sums the quantity of a dish already in the cart and keeps the notes',
    run(async (session) => {
      await service.addItem(session, { dishId: fx.dishA.id, quantity: 2, notes: 'bem passado' });
      const cart = await service.addItem(session, { dishId: fx.dishA.id, quantity: 3 });
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0]).toMatchObject({ quantity: 5, notes: 'bem passado' });
      const updated = await service.addItem(session, {
        dishId: fx.dishA.id,
        quantity: 1,
        notes: 'mal passado',
      });
      expect(updated.items[0]).toMatchObject({ quantity: 6, notes: 'mal passado' });
    }),
  );

  it(
    'rejects more than 10 units of one item with VALIDATION_ERROR (D2.6)',
    run(async (session) => {
      await service.addItem(session, { dishId: fx.dishA.id, quantity: 8 });
      await expect(
        service.addItem(session, { dishId: fx.dishA.id, quantity: 3 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }),
  );

  it(
    'rejects a dish from another restaurant, naming the current one',
    run(async (session) => {
      await service.addItem(session, { dishId: fx.dishA.id, quantity: 1 });
      await expect(
        service.addItem(session, { dishId: fx.dishB.id, quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'DIFFERENT_RESTAURANT',
        message: expect.stringContaining(fx.dishA.restaurant.name) as string,
      });
    }),
  );

  it(
    'rejects unavailable and unknown dishes',
    run(async (session) => {
      await expect(
        service.addItem(session, { dishId: fx.unavailable.id, quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'DISH_UNAVAILABLE',
      });
      await expect(
        service.addItem(session, { dishId: randomUUID(), quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'DISH_NOT_FOUND',
      });
      expect(await prisma.cart.count({ where: { sessionId: session } })).toBe(0);
    }),
  );

  it(
    'updates quantity, removes with 0 and frees the restaurant when empty (D2.5)',
    run(async (session) => {
      const added = await service.addItem(session, { dishId: fx.dishA.id, quantity: 1 });
      const itemId = added.items[0]?.id as string;

      const changed = await service.updateItem(session, itemId, 4);
      expect(changed.items[0]?.quantity).toBe(4);

      const emptied = await service.updateItem(session, itemId, 0);
      expect(emptied.items).toEqual([]);
      expect(emptied.restaurant).toBeNull();

      // The restaurant is free again: a dish from another restaurant is accepted.
      const other = await service.addItem(session, { dishId: fx.dishB.id, quantity: 1 });
      expect(other.restaurant?.slug).toBe(fx.dishB.restaurant.slug);
    }),
  );

  it(
    'does not touch items of other sessions',
    run(async (session) => {
      const added = await service.addItem(session, { dishId: fx.dishA.id, quantity: 1 });
      const itemId = added.items[0]?.id as string;
      await expect(service.updateItem(newSession(), itemId, 2)).rejects.toMatchObject({
        code: 'CART_ITEM_NOT_FOUND',
      });
      await expect(service.updateItem(session, randomUUID(), 2)).rejects.toMatchObject({
        code: 'CART_ITEM_NOT_FOUND',
      });
    }),
  );

  it(
    'clears the cart, with or without an existing cart',
    run(async (session) => {
      expect((await service.clear(session)).items).toEqual([]);
      await service.addItem(session, { dishId: fx.dishA.id, quantity: 2 });
      const cleared = await service.clear(session);
      expect(cleared).toMatchObject({ items: [], itemCount: 0, totalCents: 0, restaurant: null });
    }),
  );

  it(
    'checkout: CART_EMPTY, BELOW_MIN_ORDER with the missing amount, then success',
    run(async (session) => {
      await expect(service.checkout(session)).rejects.toMatchObject({ code: 'CART_EMPTY' });

      await service.addItem(session, { dishId: fx.belowMin.id, quantity: 1 });
      const missing = fx.belowMin.restaurant.minOrderCents - fx.belowMin.priceCents;
      await expect(service.checkout(session)).rejects.toMatchObject({
        code: 'BELOW_MIN_ORDER',
        details: { missingCents: missing },
      });
      expect((await service.getCart(session)).missingForMinOrderCents).toBe(missing);
    }),
  );

  it(
    'checkout success closes the cart and the next cart is empty (D2.7)',
    run(async (session) => {
      const { dish, quantity } = fx.meetsMin;
      const before = await service.addItem(session, { dishId: dish.id, quantity });
      const result = await service.checkout(session);
      expect(result).toEqual({
        orderId: before.id,
        totalCents: before.totalCents,
        estimatedMinutes: dish.restaurant.deliveryMaxMinutes,
      });
      expect(
        (await prisma.cart.findUniqueOrThrow({ where: { id: before.id as string } })).status,
      ).toBe('CHECKED_OUT');
      expect(await service.getCart(session)).toMatchObject({ id: null, items: [] });
      await expect(service.checkout(session)).rejects.toMatchObject({ code: 'CART_EMPTY' });
    }),
  );

  it(
    'checkout revalidates availability',
    run(async (session) => {
      const { dish, quantity } = fx.meetsMin;
      await service.addItem(session, { dishId: dish.id, quantity });
      await prisma.dish.update({ where: { id: dish.id }, data: { available: false } });
      try {
        await expect(service.checkout(session)).rejects.toMatchObject({ code: 'DISH_UNAVAILABLE' });
      } finally {
        await prisma.dish.update({ where: { id: dish.id }, data: { available: true } });
      }
    }),
  );

  it(
    'concurrent adds of the same session end up in a single open cart',
    run(async (session) => {
      await Promise.all(
        [1, 2, 3].map(() => service.addItem(session, { dishId: fx.dishA.id, quantity: 1 })),
      );
      expect(await prisma.cart.count({ where: { sessionId: session, status: 'OPEN' } })).toBe(1);
      expect((await service.getCart(session)).items[0]?.quantity).toBe(3);
    }),
  );
});
