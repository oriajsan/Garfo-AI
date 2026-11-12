import { PrismaClient } from '@prisma/client';
import { toVectorLiteral } from '../src/catalog/vector';
import { validateEnv } from '../src/config/env';
import { embeddingHash } from '../src/llm/embedding-hash';
import { createEmbeddingProvider } from '../src/llm/llm.factory';

/**
 * `pnpm db:embed`: generates embeddings (in batches of 50) only for dishes whose embedding is
 * missing or whose hash no longer matches sha256(modelId + "\n" + embeddingText). Running it
 * twice in a row processes nothing the second time, so the cost is paid once.
 */
const BATCH_SIZE = 50;

interface DishRow {
  id: string;
  embeddingText: string;
  embeddingHash: string | null;
  hasEmbedding: boolean;
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const provider = createEmbeddingProvider(env);
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

  try {
    const rows = await prisma.$queryRaw<DishRow[]>`
      SELECT id, "embeddingText", "embeddingHash", (embedding IS NOT NULL) AS "hasEmbedding"
      FROM "Dish"
      ORDER BY id`;

    const pending = rows.filter(
      (row) =>
        !row.hasEmbedding ||
        row.embeddingHash !== embeddingHash(provider.modelId, row.embeddingText),
    );

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const vectors = await provider.embed(batch.map((row) => row.embeddingText));
      if (vectors.length !== batch.length) {
        throw new Error(`Provider returned ${vectors.length} vectors for ${batch.length} texts`);
      }
      for (const [index, row] of batch.entries()) {
        const vector = vectors[index] as number[];
        const hash = embeddingHash(provider.modelId, row.embeddingText);
        await prisma.$executeRaw`
          UPDATE "Dish"
          SET embedding = ${toVectorLiteral(vector)}::vector, "embeddingHash" = ${hash}
          WHERE id = ${row.id}`;
      }
      console.log(`  batch ${i / BATCH_SIZE + 1}: ${batch.length} dishes embedded`);
    }

    console.log(
      `Embeddings (${provider.modelId}): ${pending.length} processed, ${rows.length - pending.length} already up to date.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
