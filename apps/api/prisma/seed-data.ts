import { createHash } from 'node:crypto';
import {
  allergenSchema,
  DIETARY_TAG_LABELS,
  DISH_CATEGORY_LABELS,
  dietaryTagSchema,
  dishCategorySchema,
  type Allergen,
  type DietaryTag,
} from '@garfo/shared';
import { z } from 'zod';

/**
 * Schema and rules for data/seed/restaurants.json (SPEC section 4).
 * Kept free of database access so it can be unit-tested.
 */

const MIN_PRICE_CENTS = 800; // R$ 8
const MAX_PRICE_CENTS = 12000; // R$ 120

/** Tag/allergen combinations that would make filters lie to the user. */
const CONFLICTS: ReadonlyArray<{ tag: DietaryTag; forbidden: readonly Allergen[] }> = [
  { tag: 'gluten_free', forbidden: ['gluten'] },
  { tag: 'lactose_free', forbidden: ['lactose'] },
  { tag: 'vegetarian', forbidden: ['fish', 'shellfish'] },
  { tag: 'vegan', forbidden: ['fish', 'shellfish', 'lactose', 'egg'] },
];

const seedDishSchema = z
  .object({
    name: z.string().min(3),
    description: z.string().min(10),
    priceCents: z.number().int().min(MIN_PRICE_CENTS).max(MAX_PRICE_CENTS),
    category: dishCategorySchema,
    dietaryTags: z.array(dietaryTagSchema),
    allergens: z.array(allergenSchema),
    calories: z.number().int().positive().optional(),
    serves: z.number().int().min(1).max(6).default(1),
    available: z.boolean().default(true),
  })
  .strict()
  .superRefine((dish, ctx) => {
    if (new Set(dish.dietaryTags).size !== dish.dietaryTags.length) {
      ctx.addIssue({ code: 'custom', path: ['dietaryTags'], message: 'duplicated tag' });
    }
    if (new Set(dish.allergens).size !== dish.allergens.length) {
      ctx.addIssue({ code: 'custom', path: ['allergens'], message: 'duplicated allergen' });
    }
    if (dish.dietaryTags.includes('vegan')) {
      for (const implied of ['vegetarian', 'lactose_free'] as const) {
        if (!dish.dietaryTags.includes(implied)) {
          ctx.addIssue({
            code: 'custom',
            path: ['dietaryTags'],
            message: `vegan dishes must also be tagged ${implied}`,
          });
        }
      }
    }
    for (const { tag, forbidden } of CONFLICTS) {
      if (!dish.dietaryTags.includes(tag)) continue;
      const clash = dish.allergens.filter((allergen) => forbidden.includes(allergen));
      if (clash.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['allergens'],
          message: `"${tag}" dish cannot contain ${clash.join(', ')}`,
        });
      }
    }
  });

const seedRestaurantSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().min(2),
    cuisine: z.string().min(2),
    description: z.string().min(10),
    emoji: z.string().min(1),
    rating: z.number().min(0).max(5),
    deliveryFeeCents: z.number().int().min(0),
    deliveryMinMinutes: z.number().int().min(20).max(60),
    deliveryMaxMinutes: z.number().int().min(20).max(60),
    minOrderCents: z.number().int().min(0),
    isOpen: z.boolean().default(true),
    dishes: z.array(seedDishSchema).min(12).max(15),
  })
  .strict()
  .refine((r) => r.deliveryMinMinutes <= r.deliveryMaxMinutes, {
    message: 'deliveryMinMinutes must be <= deliveryMaxMinutes',
  })
  .refine((r) => new Set(r.dishes.map((d) => d.name)).size === r.dishes.length, {
    message: 'dish names must be unique within a restaurant',
  });

/** Minimum variety the agent tests depend on (SPEC section 4). */
const VARIETY_MINIMUMS: ReadonlyArray<{ tag: DietaryTag; min: number }> = [
  { tag: 'vegetarian', min: 15 },
  { tag: 'vegan', min: 8 },
  { tag: 'gluten_free', min: 8 },
  { tag: 'lactose_free', min: 8 },
];

export const seedFileSchema = z
  .object({ restaurants: z.array(seedRestaurantSchema).length(6) })
  .strict()
  .superRefine((file, ctx) => {
    const slugs = file.restaurants.map((r) => r.slug);
    if (new Set(slugs).size !== slugs.length) {
      ctx.addIssue({ code: 'custom', path: ['restaurants'], message: 'duplicated slug' });
    }
    const dishes = file.restaurants.flatMap((r) => r.dishes);
    for (const { tag, min } of VARIETY_MINIMUMS) {
      const count = dishes.filter((d) => d.dietaryTags.includes(tag)).length;
      if (count < min) {
        ctx.addIssue({
          code: 'custom',
          path: ['restaurants'],
          message: `needs at least ${min} "${tag}" dishes, found ${count}`,
        });
      }
    }
    const prices = dishes.map((d) => d.priceCents);
    const minutes = file.restaurants.flatMap((r) => [r.deliveryMinMinutes, r.deliveryMaxMinutes]);
    const spans = [
      { label: 'price', values: prices, low: 1000, high: 11000 },
      { label: 'delivery time', values: minutes, low: 20, high: 60 },
    ];
    for (const { label, values, low, high } of spans) {
      if (Math.min(...values) > low || Math.max(...values) < high) {
        ctx.addIssue({
          code: 'custom',
          path: ['restaurants'],
          message: `${label} range is too narrow: ${Math.min(...values)}..${Math.max(...values)}`,
        });
      }
    }
  });

export type SeedFile = z.infer<typeof seedFileSchema>;
export type SeedRestaurant = SeedFile['restaurants'][number];
export type SeedDish = SeedRestaurant['dishes'][number];

/** Deterministic UUID (v5-shaped) so ids stay stable across machines and reseeds. */
export function deterministicUuid(key: string): string {
  const bytes = createHash('sha256').update(`garfo:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const restaurantId = (slug: string): string => deterministicUuid(`restaurant:${slug}`);
export const dishId = (slug: string, dishName: string): string =>
  deterministicUuid(`dish:${slug}:${dishName}`);

/**
 * `"{nome}. {descrição}. Categoria: {categoria}. Restaurante: {restaurante} ({culinária}). Tags: {tags}."`
 * Category and tags use pt-BR labels so the embedding matches Portuguese queries.
 */
export function buildEmbeddingText(restaurant: SeedRestaurant, dish: SeedDish): string {
  const tags = dish.dietaryTags.map((tag) => DIETARY_TAG_LABELS[tag]).join(', ') || 'nenhuma';
  return (
    `${dish.name}. ${dish.description}. Categoria: ${DISH_CATEGORY_LABELS[dish.category]}. ` +
    `Restaurante: ${restaurant.name} (${restaurant.cuisine}). Tags: ${tags}.`
  );
}
