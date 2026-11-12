import { Injectable } from '@nestjs/common';
import { type Cart, type Checkout } from '@garfo/shared';
import { type Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanCheckout,
  assertDishAvailable,
  assertSameRestaurant,
  buildCart,
  calculateTotals,
  mergeQuantity,
  type CartSnapshot,
} from './cart.rules';

type Tx = Prisma.TransactionClient;

/** Cart persistence. The business rules live in `cart.rules.ts`; this class only queries. */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(sessionId: string): Promise<Cart> {
    return buildCart(await this.loadOpenCart(this.prisma, sessionId));
  }

  async addItem(
    sessionId: string,
    input: { dishId: string; quantity: number; notes?: string },
  ): Promise<Cart> {
    const dish = await this.prisma.dish.findUnique({
      where: { id: input.dishId },
      include: { restaurant: true },
    });
    if (!dish) throw new DomainError('DISH_NOT_FOUND', 'Prato não encontrado.');
    assertDishAvailable(dish, dish.restaurant);

    return this.withSessionLock(sessionId, async (tx) => {
      const cart = await tx.cart.findFirst({
        where: { sessionId, status: 'OPEN' },
        include: { items: true },
      });
      const hasItems = (cart?.items.length ?? 0) > 0;
      if (cart?.restaurantId && hasItems) {
        const current = await tx.restaurant.findUniqueOrThrow({ where: { id: cart.restaurantId } });
        assertSameRestaurant(current, dish.restaurantId);
      }

      const cartId =
        cart?.id ?? (await tx.cart.create({ data: { sessionId }, select: { id: true } })).id;
      const existing = cart?.items.find((item) => item.dishId === dish.id);
      const quantity = mergeQuantity(existing?.quantity ?? 0, input.quantity);

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity, ...(input.notes !== undefined ? { notes: input.notes } : {}) },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId, dishId: dish.id, quantity, notes: input.notes ?? null },
        });
      }
      await tx.cart.update({ where: { id: cartId }, data: { restaurantId: dish.restaurantId } });
      return buildCart(await this.loadOpenCart(tx, sessionId));
    });
  }

  /** Quantity 0 removes the line; removing the last one frees the restaurant (D2.5). */
  async updateItem(sessionId: string, itemId: string, quantity: number): Promise<Cart> {
    return this.withSessionLock(sessionId, async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cart: { sessionId, status: 'OPEN' } },
      });
      if (!item) throw new DomainError('CART_ITEM_NOT_FOUND', 'Item não encontrado no carrinho.');

      if (quantity === 0) {
        await tx.cartItem.delete({ where: { id: item.id } });
        const remaining = await tx.cartItem.count({ where: { cartId: item.cartId } });
        if (remaining === 0) {
          await tx.cart.update({ where: { id: item.cartId }, data: { restaurantId: null } });
        }
      } else {
        await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
      }
      return buildCart(await this.loadOpenCart(tx, sessionId));
    });
  }

  async clear(sessionId: string): Promise<Cart> {
    return this.withSessionLock(sessionId, async (tx) => {
      const cart = await tx.cart.findFirst({ where: { sessionId, status: 'OPEN' } });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({ where: { id: cart.id }, data: { restaurantId: null } });
      }
      return buildCart(await this.loadOpenCart(tx, sessionId));
    });
  }

  /** Simulated checkout (D2.7): revalidates, applies the minimum and closes the cart. */
  async checkout(sessionId: string): Promise<Checkout> {
    return this.withSessionLock(sessionId, async (tx) => {
      const snapshot = await this.loadOpenCart(tx, sessionId);
      if (!snapshot?.restaurant || snapshot.items.length === 0) {
        throw new DomainError('CART_EMPTY', 'Seu carrinho está vazio.');
      }
      const { restaurant } = snapshot;

      const dishes = await tx.dish.findMany({
        where: { id: { in: snapshot.items.map((item) => item.dishId) } },
      });
      for (const dish of dishes) assertDishAvailable(dish, restaurant);

      const totals = calculateTotals(snapshot.items, restaurant);
      assertCanCheckout(totals);

      await tx.cart.update({ where: { id: snapshot.id }, data: { status: 'CHECKED_OUT' } });
      return {
        orderId: snapshot.id,
        totalCents: totals.totalCents,
        estimatedMinutes: restaurant.deliveryMaxMinutes,
      };
    });
  }

  /** Serialises writes of one session so two requests cannot create two open carts. */
  private withSessionLock<T>(sessionId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
      return work(tx);
    });
  }

  private async loadOpenCart(
    db: Pick<Tx, 'cart' | 'restaurant'>,
    sessionId: string,
  ): Promise<CartSnapshot | null> {
    const cart = await db.cart.findFirst({
      where: { sessionId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: { items: { include: { dish: true }, orderBy: { id: 'asc' } } },
    });
    if (!cart) return null;

    const restaurant = cart.restaurantId
      ? await db.restaurant.findUnique({ where: { id: cart.restaurantId } })
      : null;
    return {
      id: cart.id,
      status: cart.status,
      restaurant,
      items: cart.items.map((item) => ({
        id: item.id,
        dishId: item.dishId,
        name: item.dish.name,
        priceCents: item.dish.priceCents,
        quantity: item.quantity,
        notes: item.notes,
      })),
    };
  }
}
