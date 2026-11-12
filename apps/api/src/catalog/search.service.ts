import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  dishBaseSchema,
  dishCardSchema,
  dishResultSchema,
  restaurantDetailSchema,
  restaurantSummarySchema,
  type DishCard,
  type DishResult,
  type RestaurantDetail,
  type RestaurantSummary,
  type SearchDishesQuery,
} from '@garfo/shared';
import { DomainError } from '../common/domain-error';
import { LruCache } from '../common/lru-cache';
import { EMBEDDING_PROVIDER } from '../llm/llm.tokens';
import { type EmbeddingProvider } from '../llm/llm.types';
import { PrismaService } from '../prisma/prisma.service';
import { toVectorLiteral } from './vector';

const QUERY_CACHE_SIZE = 500;
const VECTOR_WEIGHT = 0.8;
const TRIGRAM_WEIGHT = 0.2;

export type SearchParams = Partial<Omit<SearchDishesQuery, 'limit'>> & { limit?: number };

interface DishRow {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  dietaryTags: string[];
  allergens: string[];
  calories: number | null;
  serves: number;
  restaurantSlug: string;
  restaurantName: string;
  restaurantEmoji: string;
  deliveryMinMinutes: number;
  deliveryMaxMinutes: number;
  score: number | null;
}

/** Hybrid search (SPEC section 5): structured filters in SQL + vector/trigram relevance. */
@Injectable()
export class SearchService {
  private readonly queryEmbeddings = new LruCache<string, number[]>(QUERY_CACHE_SIZE);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(params: SearchParams): Promise<DishResult[]> {
    const limit = params.limit ?? 8;
    const q = params.q?.trim() || undefined;

    // Every user input below is bound as a parameter by Prisma.sql; nothing is concatenated.
    const filters: Prisma.Sql[] = [Prisma.sql`d.available = true`, Prisma.sql`r."isOpen" = true`];
    if (params.maxPriceCents !== undefined) {
      filters.push(Prisma.sql`d."priceCents" <= ${params.maxPriceCents}`);
    }
    if (params.dietaryTags?.length) {
      filters.push(Prisma.sql`d."dietaryTags" @> ${params.dietaryTags}::text[]`);
    }
    if (params.excludeAllergens?.length) {
      filters.push(Prisma.sql`NOT (d.allergens && ${params.excludeAllergens}::text[])`);
    }
    if (params.maxDeliveryMinutes !== undefined) {
      filters.push(Prisma.sql`r."deliveryMaxMinutes" <= ${params.maxDeliveryMinutes}`);
    }
    if (params.category) {
      filters.push(Prisma.sql`d.category = ${params.category}::"DishCategory"`);
    }
    if (params.restaurantSlug) {
      filters.push(Prisma.sql`r.slug = ${params.restaurantSlug}`);
    }

    const columns = Prisma.sql`
      d.id, d.name, d.description, d."priceCents", d.category::text AS category,
      d."dietaryTags", d.allergens, d.calories, d.serves,
      r.slug AS "restaurantSlug", r.name AS "restaurantName", r.emoji AS "restaurantEmoji",
      r."deliveryMinMinutes", r."deliveryMaxMinutes"`;
    const where = Prisma.join(filters, ' AND ');

    let rows: DishRow[];
    if (q) {
      const vector = toVectorLiteral(await this.embedQuery(q));
      rows = await this.prisma.$queryRaw<DishRow[]>`
        SELECT * FROM (
          SELECT ${columns},
            ${VECTOR_WEIGHT}::float8 * (1 - (d.embedding <=> ${vector}::vector))
              + ${TRIGRAM_WEIGHT}::float8 * similarity(d.name, ${q}) AS score
          FROM "Dish" d
          JOIN "Restaurant" r ON r.id = d."restaurantId"
          WHERE ${where} AND d.embedding IS NOT NULL
        ) scored
        WHERE score >= ${this.embeddings.minRelevanceScore}
        ORDER BY score DESC, "priceCents" ASC, name ASC
        LIMIT ${limit}`;
    } else {
      rows = await this.prisma.$queryRaw<DishRow[]>`
        SELECT ${columns}, NULL::float8 AS score
        FROM "Dish" d
        JOIN "Restaurant" r ON r.id = d."restaurantId"
        WHERE ${where}
        ORDER BY r.rating DESC, d."priceCents" ASC, d.name ASC
        LIMIT ${limit}`;
    }

    return rows.map((row) => toDishResult(row));
  }

  async getDish(id: string): Promise<DishResult> {
    const dish = await this.prisma.dish.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!dish) throw new DomainError('DISH_NOT_FOUND', 'Prato não encontrado.');
    return dishResultSchema.parse({
      ...dish,
      restaurant: dish.restaurant,
      score: null,
    });
  }

  /** Current data of the given dishes as cards, in the order requested; unknown ids are skipped. */
  async getDishCards(ids: string[]): Promise<DishCard[]> {
    if (ids.length === 0) return [];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: ids } },
      include: { restaurant: true },
    });
    const byId = new Map(dishes.map((dish) => [dish.id, dish]));
    return ids.flatMap((id) => {
      const dish = byId.get(id);
      if (!dish) return [];
      return [
        dishCardSchema.parse({
          id: dish.id,
          name: dish.name,
          description: dish.description,
          priceCents: dish.priceCents,
          dietaryTags: dish.dietaryTags,
          restaurant: {
            slug: dish.restaurant.slug,
            name: dish.restaurant.name,
            emoji: dish.restaurant.emoji,
          },
          deliveryMinMinutes: dish.restaurant.deliveryMinMinutes,
          deliveryMaxMinutes: dish.restaurant.deliveryMaxMinutes,
        }),
      ];
    });
  }

  async getRestaurant(slug: string): Promise<RestaurantDetail> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { slug },
      include: {
        dishes: {
          where: { available: true },
          orderBy: [{ category: 'asc' }, { priceCents: 'asc' }, { name: 'asc' }],
        },
      },
    });
    if (!restaurant) {
      throw new DomainError('RESTAURANT_NOT_FOUND', 'Restaurante não encontrado.');
    }
    return restaurantDetailSchema.parse({
      ...restaurant,
      dishes: restaurant.dishes.map((dish) => dishBaseSchema.parse(dish)),
    });
  }

  async listRestaurants(): Promise<RestaurantSummary[]> {
    const restaurants = await this.prisma.restaurant.findMany({
      orderBy: [{ rating: 'desc' }, { name: 'asc' }],
    });
    return restaurants.map((restaurant) => restaurantSummarySchema.parse(restaurant));
  }

  /** Query embeddings are cached per model and normalised text (SPEC: LRU of 500 entries). */
  private async embedQuery(q: string): Promise<number[]> {
    const key = `${this.embeddings.modelId}:${q.toLowerCase().replace(/\s+/g, ' ')}`;
    const cached = this.queryEmbeddings.get(key);
    if (cached) return cached;
    const [vector] = await this.embeddings.embed([q]);
    if (!vector) throw new Error('Embedding provider returned no vector');
    this.queryEmbeddings.set(key, vector);
    return vector;
  }
}

function toDishResult(row: DishRow): DishResult {
  return dishResultSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    category: row.category,
    dietaryTags: row.dietaryTags,
    allergens: row.allergens,
    calories: row.calories,
    serves: row.serves,
    restaurant: {
      slug: row.restaurantSlug,
      name: row.restaurantName,
      emoji: row.restaurantEmoji,
      deliveryMinMinutes: row.deliveryMinMinutes,
      deliveryMaxMinutes: row.deliveryMaxMinutes,
    },
    score:
      row.score === null ? null : Math.round(Math.min(1, Math.max(0, row.score)) * 10000) / 10000,
  });
}
