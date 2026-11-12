import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildEmbeddingText, dishId, restaurantId, seedFileSchema, seedStats } from './seed-data';

/**
 * Deterministic seed: reads data/seed/restaurants.json, validates it and upserts everything
 * with stable ids. Calls no external API. Embeddings are generated later by `pnpm db:embed`,
 * which compares `embeddingHash` with the sha256 of `embeddingText`.
 */
const SEED_PATH = resolve(__dirname, '../../../data/seed/restaurants.json');

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const parsed = seedFileSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid seed file ${SEED_PATH}:\n${details}`);
  }

  const prisma = new PrismaClient();
  try {
    const seededDishIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const restaurant of parsed.data.restaurants) {
        const { dishes, ...data } = restaurant;
        const id = restaurantId(restaurant.slug);
        await tx.restaurant.upsert({
          where: { slug: restaurant.slug },
          create: { id, ...data },
          update: data,
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
      const staleRestaurants = { slug: { notIn: parsed.data.restaurants.map((r) => r.slug) } };
      await tx.restaurant.deleteMany({ where: { ...staleRestaurants, dishes: { none: {} } } });
      await tx.restaurant.updateMany({ where: staleRestaurants, data: { isOpen: false } });
    });

    const stats = seedStats(parsed.data);
    console.log(
      [
        `Seed counts (JSON): ${stats.dishes} dishes (${stats.available} available)`,
        `  vegetarian ${stats.byTag.vegetarian}, vegan ${stats.byTag.vegan}, gluten_free ${stats.byTag.gluten_free}, lactose_free ${stats.byTag.lactose_free}`,
        `  desserts <= R$ 15: ${stats.cheapDesserts}; gluten-free for 2+ under R$ 80: ${stats.glutenFreeForTwo}`,
        `  vegetarian among dishes <= R$ 40: ${stats.vegetarianUpTo40}/${stats.upTo40}`,
      ].join('\n'),
    );

    const [restaurants, dishes, unavailable] = await Promise.all([
      prisma.restaurant.count(),
      prisma.dish.count(),
      prisma.dish.count({ where: { available: false } }),
    ]);
    console.log(
      `Seed ok: ${restaurants} restaurants, ${dishes} dishes (${unavailable} unavailable).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
