import { allergenSchema, dietaryTagSchema, dishCategorySchema } from '@garfo/shared';
import { z } from 'zod';

/** The 7 tools of the agent (SPEC section 6). */
export const TOOL_NAMES = [
  'search_dishes',
  'get_restaurant',
  'get_dish',
  'view_cart',
  'add_to_cart',
  'update_cart_item',
  'clear_cart',
] as const;
export const toolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof toolNameSchema>;

export const CASE_CATEGORIES = [
  'simple_filters',
  'dietary_restrictions',
  'cart_flow',
  'restaurant_conflict',
  'no_results',
  'out_of_scope',
  'prompt_injection',
] as const;
export const caseCategorySchema = z.enum(CASE_CATEGORIES);
export type CaseCategory = z.infer<typeof caseCategorySchema>;

/** Exactly how many cases of each category the SPEC (section 8) asks for. */
export const EXPECTED_DISTRIBUTION: Record<CaseCategory, number> = {
  simple_filters: 6,
  dietary_restrictions: 4,
  cart_flow: 3,
  restaurant_conflict: 2,
  no_results: 2,
  out_of_scope: 2,
  prompt_injection: 1,
};

/**
 * Condition on one tool argument. Several operators in the same object must all hold:
 * `{ "gte": 1, "lte": 40 }`. `lte`/`gte` compare numbers (a ceiling like "up to R$ 40" accepts
 * any value at or below it); `includes` checks membership in an array (or a substring in a
 * string); `equals` is strict equality.
 */
export const argConditionSchema = z
  .object({
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    includes: z.string().optional(),
    lte: z.number().optional(),
    gte: z.number().optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'at least one operator is required');
export type ArgCondition = z.infer<typeof argConditionSchema>;

const argsSchema = z.record(argConditionSchema);

/**
 * "Some call to `tool` satisfied all conditions in `args`" or, with `anyOf`, "...satisfied all
 * conditions of at least one of the alternatives" (e.g. gluten-free as a tag OR as an excluded
 * allergen: both are correct ways to honour the restriction).
 */
export const toolArgsExpectationSchema = z
  .object({
    tool: toolNameSchema,
    args: argsSchema.optional(),
    anyOf: z.array(argsSchema).min(2).optional(),
  })
  .strict()
  .refine((e) => (e.args === undefined) !== (e.anyOf === undefined), 'use either args or anyOf');
export type ToolArgsExpectation = z.infer<typeof toolArgsExpectationSchema>;

/** Properties every recommended card must have, checked against the database. */
export const recommendedDishesSatisfySchema = z
  .object({
    maxPriceReais: z.number().positive().optional(),
    requiredTags: z.array(dietaryTagSchema).optional(),
    excludeAllergens: z.array(allergenSchema).optional(),
    maxDeliveryMinutes: z.number().int().positive().optional(),
    category: dishCategorySchema.optional(),
  })
  .strict();
export type RecommendedDishesSatisfy = z.infer<typeof recommendedDishesSatisfySchema>;

/** Final cart: either empty or exactly these dishes (by name) with these quantities. */
export const cartAfterSchema = z.union([
  z.object({ empty: z.literal(true) }).strict(),
  z
    .object({
      items: z
        .array(
          z
            .object({ dishName: z.string().min(1), quantity: z.number().int().min(1).max(10) })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);
export type CartAfter = z.infer<typeof cartAfterSchema>;

export const expectationsSchema = z
  .object({
    mustCallTools: z.array(toolNameSchema).optional(),
    mustNotCallTools: z.array(toolNameSchema).optional(),
    /** Minimum number of calls (counting repeats) per tool, e.g. `{ "add_to_cart": 2 }`. */
    minToolCalls: z.record(toolNameSchema, z.number().int().min(1)).optional(),
    toolArgs: z.array(toolArgsExpectationSchema).optional(),
    recommendedDishesSatisfy: recommendedDishesSatisfySchema.optional(),
    /** At least this many dish cards in the whole conversation (otherwise "satisfy" is vacuous). */
    minRecommendations: z.number().int().min(1).optional(),
    /** At most this many dish cards in any single assistant reply. */
    maxRecommendations: z.number().int().min(0).optional(),
    cartAfter: cartAfterSchema.optional(),
    /** Every `[[dish:id]]` the model wrote must come from a tool result of the conversation. */
    noHallucinatedDishes: z.boolean().optional(),
  })
  .strict();
export type Expectations = z.infer<typeof expectationsSchema>;

export const evalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    category: caseCategorySchema,
    description: z.string().min(1),
    /** One user message per turn, in order. */
    input: z.array(z.string().min(1).max(500)).min(1),
    expect: expectationsSchema,
  })
  .strict();
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalCasesFileSchema = z
  .array(evalCaseSchema)
  .length(20)
  .superRefine((cases, ctx) => {
    const ids = new Set<string>();
    for (const c of cases) {
      if (ids.has(c.id))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id ${c.id}` });
      ids.add(c.id);
    }
    for (const category of CASE_CATEGORIES) {
      const count = cases.filter((c) => c.category === category).length;
      if (count !== EXPECTED_DISTRIBUTION[category]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `category ${category}: expected ${EXPECTED_DISTRIBUTION[category]}, found ${count}`,
        });
      }
    }
  });
export type EvalCasesFile = z.infer<typeof evalCasesFileSchema>;
