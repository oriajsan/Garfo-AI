import { formatBRL } from '@garfo/shared';
import { z } from 'zod';
import { type SearchService } from '../catalog/search.service';
import { toMenuDish } from './tool.format';
import { defineTool } from './tool.types';

export const getRestaurantSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe('Slug do restaurante, como veio em search_dishes.'),
});

export function createGetRestaurantTool(search: SearchService) {
  return defineTool({
    name: 'get_restaurant',
    description:
      'Devolve os dados de um restaurante e o cardápio resumido. Use quando o usuário perguntar ' +
      '"o que mais tem nesse lugar?". Não use para buscar pratos por preferência (use search_dishes).',
    schema: getRestaurantSchema,
    async handler(args) {
      const restaurant = await search.getRestaurant(args.slug);
      return {
        result: {
          restaurant: {
            slug: restaurant.slug,
            name: restaurant.name,
            cuisine: restaurant.cuisine,
            rating: restaurant.rating,
            deliveryFee: formatBRL(restaurant.deliveryFeeCents),
            minOrder: formatBRL(restaurant.minOrderCents),
            delivery: `${restaurant.deliveryMinMinutes}-${restaurant.deliveryMaxMinutes} min`,
            isOpen: restaurant.isOpen,
          },
          dishes: restaurant.dishes.map(toMenuDish),
        },
      };
    },
    label: (args) => `Consultando o cardápio de ${args.slug.replace(/-/g, ' ')}…`,
  });
}
