import { MAX_ITEM_QUANTITY } from '@garfo/shared';
import { z } from 'zod';
import { type CartService } from '../cart/cart.service';
import { toToolCart } from './tool.format';
import { defineTool } from './tool.types';

export const updateCartItemSchema = z.object({
  item_id: z
    .string()
    .min(1)
    .max(64)
    .describe('itemId da linha do carrinho (veja view_cart ou add_to_cart), não o id do prato.'),
  quantity: z
    .number()
    .int()
    .min(0)
    .max(MAX_ITEM_QUANTITY)
    .describe('Nova quantidade, de 0 a 10. Zero remove o item.'),
});

export function createUpdateCartItemTool(cart: CartService) {
  return defineTool({
    name: 'update_cart_item',
    description:
      'Altera a quantidade de um item que já está no carrinho (0 remove). Use quando o usuário pedir para ' +
      'mudar a quantidade ou tirar um item. Para adicionar um prato novo, use add_to_cart.',
    schema: updateCartItemSchema,
    async handler(args, ctx) {
      const updated = await cart.updateItem(ctx.sessionId, args.item_id, args.quantity);
      return { result: { cart: toToolCart(updated) }, cart: updated };
    },
    label: (args) =>
      args.quantity === 0
        ? 'Removendo o item do carrinho…'
        : `Atualizando a quantidade para ${args.quantity}…`,
  });
}
