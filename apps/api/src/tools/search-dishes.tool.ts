import {
  allergenSchema,
  ALLERGEN_LABELS,
  DIETARY_TAG_LABELS,
  dietaryTagSchema,
  dishCategorySchema,
  reaisToCents,
} from '@garfo/shared';
import { z } from 'zod';
import { type SearchService } from '../catalog/search.service';
import { formatReaisCompact, toSearchDish } from './tool.format';
import { defineTool } from './tool.types';

export const searchDishesSchema = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .describe(
      'O que o usuário quer comer, em poucas palavras (ex.: "algo leve e fresco"). Pode ser vazio se só houver filtros.',
    ),
  max_price_reais: z
    .number()
    .positive()
    .max(1000)
    .optional()
    .describe('Preço máximo por prato, em reais (ex.: 40).'),
  dietary_tags: z
    .array(dietaryTagSchema)
    .max(7)
    .optional()
    .describe(
      'Restrições alimentares E características do prato; o prato precisa ter TODAS as tags pedidas. ' +
        'Mapeamento: picante/apimentado=spicy, proteico/rico em proteína=high_protein, leve=light, ' +
        'vegetariano=vegetarian, vegano=vegan, sem glúten=gluten_free, sem lactose=lactose_free. ' +
        'Se o usuário pedir qualquer uma dessas características, use a tag, não apenas a query.',
    ),
  exclude_allergens: z
    .array(allergenSchema)
    .max(8)
    .optional()
    .describe('Alergênicos que o prato NÃO pode conter.'),
  max_delivery_minutes: z
    .number()
    .int()
    .positive()
    .max(240)
    .optional()
    .describe('Tempo máximo de entrega, em minutos.'),
  category: dishCategorySchema
    .optional()
    .describe(
      'STARTER=entrada, MAIN=prato principal, SNACK=lanche, PIZZA=pizza, DESSERT=sobremesa, DRINK=bebida.',
    ),
  restaurant_slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('Limita a busca a um restaurante (slug).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(5)
    .describe('Quantidade de pratos (1 a 8, padrão 5).'),
});

export function createSearchDishesTool(search: SearchService) {
  return defineTool({
    name: 'search_dishes',
    description:
      'Busca pratos reais no cardápio com filtros estruturados e relevância semântica. ' +
      'Use SEMPRE antes de recomendar qualquer prato, incluindo todos os filtros que o usuário informou ' +
      '(preço, restrições, alergênicos, tempo, categoria). Não use para consultar o carrinho nem para ' +
      'detalhar um prato já conhecido (use get_dish).',
    schema: searchDishesSchema,
    async handler(args) {
      const results = await search.search({
        q: args.query || undefined,
        maxPriceCents:
          args.max_price_reais === undefined ? undefined : reaisToCents(args.max_price_reais),
        dietaryTags: args.dietary_tags,
        excludeAllergens: args.exclude_allergens,
        maxDeliveryMinutes: args.max_delivery_minutes,
        category: args.category,
        restaurantSlug: args.restaurant_slug,
        limit: args.limit,
      });
      return { result: { count: results.length, results: results.map(toSearchDish) } };
    },
    label(args) {
      const parts: string[] = [];
      const tags = (args.dietary_tags ?? []).map((tag) => pluralize(DIETARY_TAG_LABELS[tag]));
      const base =
        tags.length > 0 ? `pratos ${tags.join(' e ')}` : args.query ? `"${args.query}"` : 'pratos';
      parts.push(base);
      if (args.exclude_allergens?.length) {
        parts.push(`sem ${args.exclude_allergens.map((a) => ALLERGEN_LABELS[a]).join(' e ')}`);
      }
      if (args.max_price_reais !== undefined)
        parts.push(`até ${formatReaisCompact(args.max_price_reais)}`);
      if (args.max_delivery_minutes !== undefined)
        parts.push(`em até ${args.max_delivery_minutes} min`);
      return `Buscando ${parts.join(' ')}…`;
    },
  });
}

function pluralize(label: string): string {
  return label.endsWith('o') ? `${label}s` : label;
}
