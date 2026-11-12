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

/** Exactly one of tag / allergen must hold: `dietary_tags` and `exclude_allergens` filters agree. */
const EXCLUSIVE_PAIRS: ReadonlyArray<{ tag: DietaryTag; allergen: Allergen }> = [
  { tag: 'gluten_free', allergen: 'gluten' },
  { tag: 'lactose_free', allergen: 'lactose' },
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
    // Tags and allergens must agree in both directions (D1.3).
    for (const { tag, allergen } of EXCLUSIVE_PAIRS) {
      const tagged = dish.dietaryTags.includes(tag);
      const flagged = dish.allergens.includes(allergen);
      if (tagged && flagged) {
        ctx.addIssue({
          code: 'custom',
          path: ['allergens'],
          message: `"${tag}" dish cannot list allergen "${allergen}"`,
        });
      } else if (!tagged && !flagged) {
        ctx.addIssue({
          code: 'custom',
          path: ['dietaryTags'],
          message: `dish without "${tag}" must list allergen "${allergen}"`,
        });
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

/**
 * Variety the agent tests depend on (SPEC section 4), counting available dishes only.
 * Vegetarian/vegan also have upper bounds so the filters really discriminate (D1.2).
 */
const VARIETY_RANGES: ReadonlyArray<{ tag: DietaryTag; min: number; max?: number }> = [
  { tag: 'vegetarian', min: 15, max: 38 },
  { tag: 'vegan', min: 8, max: 18 },
  { tag: 'gluten_free', min: 8 },
  { tag: 'lactose_free', min: 8 },
];

const DIETARY_TAGS_COUNTED: readonly DietaryTag[] = [
  'vegetarian',
  'vegan',
  'gluten_free',
  'lactose_free',
];

interface SeedFileLike {
  restaurants: ReadonlyArray<{
    dishes: ReadonlyArray<{
      priceCents: number;
      category: string;
      dietaryTags: readonly DietaryTag[];
      serves: number;
      available: boolean;
    }>;
  }>;
}

/** Counts used both for validation and for the summary printed by the seed. */
export function seedStats(file: SeedFileLike) {
  const dishes = file.restaurants.flatMap((r) => r.dishes);
  const available = dishes.filter((d) => d.available);
  const count = (list: typeof dishes, tag: DietaryTag): number =>
    list.filter((d) => d.dietaryTags.includes(tag)).length;
  const byTag = {} as Record<DietaryTag, number>;
  const availableByTag = {} as Record<DietaryTag, number>;
  for (const tag of DIETARY_TAGS_COUNTED) {
    byTag[tag] = count(dishes, tag);
    availableByTag[tag] = count(available, tag);
  }
  const cheap = dishes.filter((d) => d.priceCents <= 4000);
  return {
    restaurants: file.restaurants.length,
    dishes: dishes.length,
    available: available.length,
    byTag,
    availableByTag,
    cheapDesserts: dishes.filter((d) => d.category === 'DESSERT' && d.priceCents <= 1500).length,
    glutenFreeForTwo: dishes.filter(
      (d) => d.dietaryTags.includes('gluten_free') && d.serves >= 2 && d.priceCents < 8000,
    ).length,
    upTo40: cheap.length,
    vegetarianUpTo40: cheap.filter((d) => d.dietaryTags.includes('vegetarian')).length,
  };
}

export const seedFileSchema = z
  .object({ restaurants: z.array(seedRestaurantSchema).length(6) })
  .strict()
  .superRefine((file, ctx) => {
    const slugs = file.restaurants.map((r) => r.slug);
    if (new Set(slugs).size !== slugs.length) {
      ctx.addIssue({ code: 'custom', path: ['restaurants'], message: 'duplicated slug' });
    }
    const dishes = file.restaurants.flatMap((r) => r.dishes);
    const stats = seedStats(file);
    for (const { tag, min, max } of VARIETY_RANGES) {
      const count = stats.availableByTag[tag];
      if (count < min || (max !== undefined && count > max)) {
        ctx.addIssue({
          code: 'custom',
          path: ['restaurants'],
          message: `needs ${min}..${max ?? 'any'} available "${tag}" dishes, found ${count}`,
        });
      }
    }
    const totals = [
      { label: 'dishes tagged "vegetarian"', count: stats.byTag.vegetarian, min: 32, max: 38 },
      { label: 'dishes tagged "vegan"', count: stats.byTag.vegan, min: 14, max: 18 },
      { label: 'desserts up to R$ 15', count: stats.cheapDesserts, min: 3, max: Infinity },
      {
        label: 'gluten-free dishes serving 2+ under R$ 80',
        count: stats.glutenFreeForTwo,
        min: 2,
        max: Infinity,
      },
    ];
    for (const { label, count, min, max } of totals) {
      if (count < min || count > max) {
        ctx.addIssue({
          code: 'custom',
          path: ['restaurants'],
          message: `needs ${min}..${max} ${label}, found ${count}`,
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
