import { z } from 'zod';

/** Domain and transport error codes (SPEC section 5, D2.8). */
export const ERROR_CODES = [
  'DIFFERENT_RESTAURANT',
  'DISH_UNAVAILABLE',
  'DISH_NOT_FOUND',
  'BELOW_MIN_ORDER',
  'CART_EMPTY',
  'RATE_LIMITED',
  'BUDGET_EXCEEDED',
  'VALIDATION_ERROR',
  'RESTAURANT_NOT_FOUND',
  'CART_ITEM_NOT_FOUND',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'CONVERSATION_NOT_FOUND',
  'LLM_ERROR',
  'TOOL_TIMEOUT',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status per error code (D2.8). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  DISH_NOT_FOUND: 404,
  RESTAURANT_NOT_FOUND: 404,
  CART_ITEM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  CONVERSATION_NOT_FOUND: 404,
  DIFFERENT_RESTAURANT: 409,
  DISH_UNAVAILABLE: 409,
  BELOW_MIN_ORDER: 422,
  CART_EMPTY: 422,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  LLM_ERROR: 502,
  TOOL_TIMEOUT: 504,
};

/** Error body returned by every failing endpoint: `{ error: { code, message } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
