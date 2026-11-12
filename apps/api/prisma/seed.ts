import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedFileSchema, seedStats } from './seed-data';
import { applySeed, resolveSeedTxOptions } from './seed-apply';

/**
 * Deterministic seed: reads data/seed/restaurants.json, validates it and upserts everything
 * with stable ids. Calls no external API. Embeddings are generated later by `pnpm db:embed`,
 * which compares `embeddingHash` with the sha256 of `embeddingText`.
 */
// SEED_PATH lets the compiled copy in the Docker image (dist-bootstrap/) find the JSON.
const SEED_PATH =
  process.env.SEED_PATH ?? resolve(__dirname, '../../../data/seed/restaurants.json');

async function main(): Promise<void> {
  // Validate the env before touching the file or the database.
  const txOptions = resolveSeedTxOptions(process.env);
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
    await applySeed(prisma, parsed.data, txOptions);

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
