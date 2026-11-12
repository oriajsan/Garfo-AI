import { formatBRL } from '@garfo/shared';
import { z } from 'zod';
import { type SearchService } from '../catalog/search.service';
import { defineTool } from './tool.types';

export const getDishSchema = z.object({
  dish_id: z.string().uuid().describe('Id do prato (UUID), como veio em um resultado de tool.'),
});

export function createGetDishTool(search: SearchService) {
  return defineTool({
    name: 'get_dish',
    description:
      'Devolve os detalhes completos de um prato (descrição, tags, alergênicos, calorias, porções). ' +
      'Use para perguntas sobre ingredientes e alergênicos de um prato já conhecido. ' +
      'Não use para descobrir pratos novos (use search_dishes).',
    schema: getDishSchema,
    async handler(args) {
      const dish = await search.getDish(args.dish_id);
      return {
        result: {
          id: dish.id,
          name: dish.name,
          description: dish.description,
          price: formatBRL(dish.priceCents),
          priceCents: dish.priceCents,
          category: dish.category,
          dietaryTags: dish.dietaryTags,
          allergens: dish.allergens,
          calories: dish.calories,
          serves: dish.serves,
          restaurant: { slug: dish.restaurant.slug, name: dish.restaurant.name },
          delivery: `${dish.restaurant.deliveryMinMinutes}-${dish.restaurant.deliveryMaxMinutes} min`,
        },
      };
    },
    label: (args, names) => {
      const name = names.get(args.dish_id);
      return name ? `Consultando detalhes de ${name}…` : 'Consultando detalhes do prato…';
    },
  });
}
