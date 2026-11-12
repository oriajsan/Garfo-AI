import { z } from 'zod';
import { dietaryTagSchema } from './catalog';
import { cartSchema } from './cart';
import { errorCodeSchema } from './errors';

/** Limits of the chat endpoint (SPEC section 6). */
export const MAX_MESSAGE_LENGTH = 500;

/** Body of `POST /chat`: 1 to 500 characters after trimming. */
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  conversationId: z.string().uuid().optional(),
});
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

/** Compact dish shown as a card under an assistant message. */
export const dishCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int(),
  dietaryTags: z.array(dietaryTagSchema),
  restaurant: z.object({ slug: z.string(), name: z.string(), emoji: z.string() }),
  deliveryMinMinutes: z.number().int(),
  deliveryMaxMinutes: z.number().int(),
});
export type DishCard = z.infer<typeof dishCardSchema>;

export const chatUsageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
});
export type ChatUsage = z.infer<typeof chatUsageSchema>;

/**
 * SSE events (SPEC section 6) as a discriminated union. On the wire each event is
 * `event: <type>` + `data: <json of data>`; `type` is the SSE event name.
 */
export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), data: z.object({ conversationId: z.string() }) }),
  z.object({ type: z.literal('token'), data: z.object({ text: z.string() }) }),
  /**
   * The text streamed so far for the CURRENT model call was cut short and is being discarded
   * (the agent retries once, or fails). The client wipes the text of that call, not earlier
   * text, tool runs or cards. Older clients ignore unknown events.
   */
  z.object({
    type: z.literal('message_reset'),
    data: z.object({ reason: z.literal('truncated') }),
  }),
  z.object({
    type: z.literal('tool_start'),
    data: z.object({ id: z.string(), name: z.string(), label: z.string() }),
  }),
  z.object({
    type: z.literal('tool_end'),
    data: z.object({ id: z.string(), name: z.string(), ok: z.boolean() }),
  }),
  z.object({ type: z.literal('dish_cards'), data: z.object({ dishes: z.array(dishCardSchema) }) }),
  z.object({ type: z.literal('cart_updated'), data: z.object({ cart: cartSchema }) }),
  z.object({
    type: z.literal('done'),
    data: z.object({ usage: chatUsageSchema, latencyMs: z.number().int() }),
  }),
  z.object({
    type: z.literal('error'),
    data: z.object({ code: errorCodeSchema, message: z.string() }),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
export type ChatEventType = ChatEvent['type'];

/** One visible message of `GET /chat/:conversationId/messages` (no tool messages). */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  dishCards: z.array(dishCardSchema),
  createdAt: z.string(),
});
export type ChatMessageView = z.infer<typeof chatMessageSchema>;

export const chatMessagesResponseSchema = z.object({
  conversationId: z.string(),
  messages: z.array(chatMessageSchema),
});
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;
