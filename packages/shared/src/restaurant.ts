import { z } from 'zod';
import { allergenSchema, dietaryTagSchema, dishCategorySchema } from './catalog';

export const restaurantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  cuisine: z.string(),
  description: z.string(),
  emoji: z.string(),
  rating: z.number(),
  deliveryFeeCents: z.number().int(),
  deliveryMinMinutes: z.number().int(),
  deliveryMaxMinutes: z.number().int(),
  minOrderCents: z.number().int(),
  isOpen: z.boolean(),
});
export type RestaurantSummary = z.infer<typeof restaurantSummarySchema>;

/** Dish fields common to the restaurant menu and to search results. */
export const dishBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int(),
  category: dishCategorySchema,
  dietaryTags: z.array(dietaryTagSchema),
  allergens: z.array(allergenSchema),
  calories: z.number().int().nullable(),
  serves: z.number().int(),
});
export type DishBase = z.infer<typeof dishBaseSchema>;

export const restaurantDetailSchema = restaurantSummarySchema.extend({
  dishes: z.array(dishBaseSchema),
});
export type RestaurantDetail = z.infer<typeof restaurantDetailSchema>;

export const dishResultSchema = dishBaseSchema.extend({
  restaurant: z.object({
    slug: z.string(),
    name: z.string(),
    emoji: z.string(),
    deliveryMinMinutes: z.number().int(),
    deliveryMaxMinutes: z.number().int(),
  }),
  /** Relevance 0..1 when the search had `q`; `null` otherwise. */
  score: z.number().nullable(),
});
export type DishResult = z.infer<typeof dishResultSchema>;

export const dishSearchResponseSchema = z.object({ results: z.array(dishResultSchema) });
export type DishSearchResponse = z.infer<typeof dishSearchResponseSchema>;

/** Treats `?x=` (empty) like an absent parameter. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/** Accepts `a,b` or repeated `?k=a&k=b` and yields a trimmed list, validated by `item`. */
function csvOf<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value: unknown): unknown => {
    if (value === undefined || value === '') return undefined;
    const parts: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
    return parts
      .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
      .map((part) => (typeof part === 'string' ? part.trim() : part))
      .filter((part) => part !== '');
  }, z.array(item).max(20).optional());
}

const optionalInt = (min: number, max?: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int()
      .min(min)
      .max(max ?? Number.MAX_SAFE_INTEGER)
      .optional(),
  );

/** Query string of `GET /dishes/search` (SPEC section 5). */
export const searchDishesQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  maxPriceCents: optionalInt(1),
  dietaryTags: csvOf(dietaryTagSchema),
  excludeAllergens: csvOf(allergenSchema),
  maxDeliveryMinutes: optionalInt(1),
  category: z.preprocess(emptyToUndefined, dishCategorySchema.optional()),
  restaurantSlug: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(80).optional()),
  limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(20).default(8)),
});
export type SearchDishesQuery = z.infer<typeof searchDishesQuerySchema>;
