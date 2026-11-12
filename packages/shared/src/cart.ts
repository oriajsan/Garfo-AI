import { z } from 'zod';

export const MAX_ITEM_QUANTITY = 10;

export const cartItemSchema = z.object({
  id: z.string(),
  dishId: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  quantity: z.number().int(),
  notes: z.string().nullable(),
  lineTotalCents: z.number().int(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

/** Cart payload (D2.9). An empty cart has `id: null`, `restaurant: null` and fee 0. */
export const cartSchema = z.object({
  id: z.string().nullable(),
  status: z.enum(['OPEN', 'CHECKED_OUT']),
  restaurant: z
    .object({
      slug: z.string(),
      name: z.string(),
      emoji: z.string(),
      deliveryFeeCents: z.number().int(),
      minOrderCents: z.number().int(),
      deliveryMinMinutes: z.number().int(),
      deliveryMaxMinutes: z.number().int(),
    })
    .nullable(),
  items: z.array(cartItemSchema),
  itemCount: z.number().int(),
  subtotalCents: z.number().int(),
  deliveryFeeCents: z.number().int(),
  totalCents: z.number().int(),
  minOrderCents: z.number().int(),
  missingForMinOrderCents: z.number().int(),
});
export type Cart = z.infer<typeof cartSchema>;

export const checkoutSchema = z.object({
  orderId: z.string(),
  totalCents: z.number().int(),
  estimatedMinutes: z.number().int(),
});
export type Checkout = z.infer<typeof checkoutSchema>;

/** Body of `POST /cart/items`. */
export const addCartItemSchema = z.object({
  dishId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  notes: z.string().trim().max(200).optional(),
});
export type AddCartItemBody = z.infer<typeof addCartItemSchema>;

/** Body of `PATCH /cart/items/:itemId` (0 removes the item). */
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(MAX_ITEM_QUANTITY),
});
export type UpdateCartItemBody = z.infer<typeof updateCartItemSchema>;
