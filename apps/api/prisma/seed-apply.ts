import { type PrismaClient } from '@prisma/client';
import { buildEmbeddingText, dishId, restaurantId, type SeedFile } from './seed-data';

/**
 * Interactive-transaction limits for the seed. Prisma defaults (timeout 5 s, maxWait 2 s) are too
 * short for ~86 sequential upserts over a remote database such as Neon.
 */
export const DEFAULT_SEED_TX_TIMEOUT_MS = 120_000;
export const DEFAULT_SEED_TX_MAX_WAIT_MS = 20_000;

export interface SeedTxOptions {
  timeout: number;
  maxWait: number;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`Invalid ${name}="${raw}": expected a positive integer (milliseconds).`);
  }
  return Number(value);
}

/** Reads SEED_TX_TIMEOUT_MS / SEED_TX_MAX_WAIT_MS; throws on invalid values. */
export function resolveSeedTxOptions(env: NodeJS.ProcessEnv): SeedTxOptions {
  return {
    timeout: positiveInt(env, 'SEED_TX_TIMEOUT_MS', DEFAULT_SEED_TX_TIMEOUT_MS),
    maxWait: positiveInt(env, 'SEED_TX_MAX_WAIT_MS', DEFAULT_SEED_TX_MAX_WAIT_MS),
  };
}

/** Upserts everything in one interactive transaction (atomic and idempotent). */
export async function applySeed(
  prisma: Pick<PrismaClient, '$transaction'>,
  data: SeedFile,
  options: SeedTxOptions,
): Promise<void> {
  const seededDishIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const restaurant of data.restaurants) {
      const { dishes, ...rest } = restaurant;
      const id = restaurantId(restaurant.slug);
      await tx.restaurant.upsert({
        where: { slug: restaurant.slug },
        create: { id, ...rest },
        update: rest,
      });

      for (const dish of dishes) {
        const dishData = {
          ...dish,
          restaurantId: id,
          calories: dish.calories ?? null,
          embeddingText: buildEmbeddingText(restaurant, dish),
        };
        const key = dishId(restaurant.slug, dish.name);
        seededDishIds.push(key);
        await tx.dish.upsert({
          where: { id: key },
          create: { id: key, ...dishData },
          update: dishData,
        });
      }
    }

    // Dishes removed from the JSON: delete when unused, otherwise hide them.
    const stale = { id: { notIn: seededDishIds } };
    await tx.dish.deleteMany({ where: { ...stale, cartItems: { none: {} } } });
    await tx.dish.updateMany({ where: stale, data: { available: false } });

    // Same for restaurants no longer in the JSON (only possible once their dishes are gone).
    const staleRestaurants = { slug: { notIn: data.restaurants.map((r) => r.slug) } };
    await tx.restaurant.deleteMany({ where: { ...staleRestaurants, dishes: { none: {} } } });
    await tx.restaurant.updateMany({ where: staleRestaurants, data: { isOpen: false } });
  }, options);
}
