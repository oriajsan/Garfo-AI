import { z } from 'zod';
import { type CartService } from '../cart/cart.service';
import { toToolCart } from './tool.format';
import { defineTool } from './tool.types';

export const clearCartSchema = z.object({});

export function createClearCartTool(cart: CartService) {
  return defineTool({
    name: 'clear_cart',
    description:
      'Esvazia o carrinho. Use SOMENTE quando o usuário pedir explicitamente para limpar ou esvaziar o carrinho. ' +
      'Nunca use por iniciativa própria nem para trocar de restaurante sem o usuário confirmar.',
    schema: clearCartSchema,
    async handler(_args, ctx) {
      const updated = await cart.clear(ctx.sessionId);
      return { result: { cart: toToolCart(updated) }, cart: updated };
    },
    label: () => 'Esvaziando o carrinho…',
  });
}
