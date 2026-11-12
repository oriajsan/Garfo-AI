import { MAX_ITEM_QUANTITY } from '@garfo/shared';
import { z } from 'zod';
import { type CartService } from '../cart/cart.service';
import { toToolCart } from './tool.format';
import { defineTool } from './tool.types';

export const addToCartSchema = z.object({
  dish_id: z.string().uuid().describe('Id do prato (UUID) vindo de um resultado de tool.'),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY).describe('Quantidade, de 1 a 10.'),
  notes: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Observação do usuário para o prato (ex.: "sem cebola").'),
});

export function createAddToCartTool(cart: CartService) {
  return defineTool({
    name: 'add_to_cart',
    description:
      'Adiciona um prato ao carrinho. Use SOMENTE quando o usuário pedir claramente ("adiciona", "quero esse", ' +
      '"coloca no carrinho"); "quero esse" se refere ao prato citado por último. Se o carrinho for de outro ' +
      'restaurante, a tool devolve o erro DIFFERENT_RESTAURANT: explique e pergunte se o usuário quer trocar. ' +
      'Não use para apenas recomendar.',
    schema: addToCartSchema,
    async handler(args, ctx) {
      const updated = await cart.addItem(ctx.sessionId, {
        dishId: args.dish_id,
        quantity: args.quantity,
        ...(args.notes ? { notes: args.notes } : {}),
      });
      const line = updated.items.find((item) => item.dishId === args.dish_id);
      return {
        result: {
          added: { dishId: args.dish_id, name: line?.name ?? null, quantity: args.quantity },
          cart: toToolCart(updated),
        },
        cart: updated,
      };
    },
    label: (args, names) =>
      `Adicionando ${args.quantity}× ${names.get(args.dish_id) ?? 'o prato'} ao carrinho…`,
  });
}
