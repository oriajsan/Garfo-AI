import { type Dish, type Restaurant } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import { validateEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Helpers for tests that talk to the local Postgres. Excluded from the production build. */
export const SKIP_MESSAGE =
  'Postgres is not reachable (start it with `docker compose up -d db`, then `pnpm db:setup`): integration test skipped.';

export function createPrisma(): PrismaService {
  return new PrismaService(new ConfigService(validateEnv(process.env)));
}

/**
 * Connects, or reports that the database is missing. Outside CI the tests skip with a clear
 * message; in CI (`CI=true`) a missing database must fail the run.
 */
export async function connectOrSkip(prisma: PrismaService): Promise<boolean> {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    if (process.env.CI) throw error;
    return false;
  }
}

/** Wraps a test body so it is skipped (with a warning) when the database is unavailable. */
export function whenDb(isReady: () => boolean, body: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!isReady()) {
      console.warn(SKIP_MESSAGE);
      return;
    }
    await body();
  };
}

type DishWithRestaurant = Dish & { restaurant: Restaurant };

export interface Fixtures {
  dishA: DishWithRestaurant;
  /** From a different restaurant than `dishA`. */
  dishB: DishWithRestaurant;
  unavailable: DishWithRestaurant;
  /** One unit costs less than the restaurant minimum order. */
  belowMin: DishWithRestaurant;
  /** `quantity` units reach the restaurant minimum order. */
  meetsMin: { dish: DishWithRestaurant; quantity: number };
}

/** Picks seed dishes by property, so tests do not depend on specific names. */
export async function loadFixtures(prisma: PrismaService): Promise<Fixtures> {
  const dishes = await prisma.dish.findMany({
    include: { restaurant: true },
    orderBy: [{ priceCents: 'asc' }, { id: 'asc' }],
  });
  const available = dishes.filter((dish) => dish.available && dish.restaurant.isOpen);

  const dishA = available[0];
  const dishB = available.find((dish) => dish.restaurantId !== dishA?.restaurantId);
  const unavailable = dishes.find((dish) => !dish.available);
  const belowMin = available.find((dish) => dish.priceCents < dish.restaurant.minOrderCents);
  const meets = available.find((dish) => {
    const quantity = Math.ceil(dish.restaurant.minOrderCents / dish.priceCents);
    return quantity <= 10;
  });
  if (!dishA || !dishB || !unavailable || !belowMin || !meets) {
    throw new Error('Seed data is missing the dishes the tests need (run `pnpm db:seed`).');
  }
  return {
    dishA,
    dishB,
    unavailable,
    belowMin,
    meetsMin: {
      dish: meets,
      quantity: Math.max(1, Math.ceil(meets.restaurant.minOrderCents / meets.priceCents)),
    },
  };
}
