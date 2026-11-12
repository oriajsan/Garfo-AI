import { z } from 'zod';
import { type CartService } from '../cart/cart.service';
import { toToolCart } from './tool.format';
import { defineTool } from './tool.types';

export const viewCartSchema = z.object({});

export function createViewCartTool(cart: CartService) {
  return defineTool({
    name: 'view_cart',
    description:
      'Mostra o carrinho atual: itens, subtotal, taxa de entrega, total e pedido mínimo. ' +
      'Use quando o usuário perguntar o que já escolheu ou quanto deu. Não altera nada.',
    schema: viewCartSchema,
    async handler(_args, ctx) {
      return { result: { cart: toToolCart(await cart.getCart(ctx.sessionId)) } };
    },
    label: () => 'Conferindo o seu carrinho…',
  });
}
