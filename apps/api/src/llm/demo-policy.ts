import { type Allergen, type DietaryTag, type DishCategory } from '@garfo/shared';
import { z } from 'zod';
import { type FakeTurn } from './fake-llm.provider';
import { type ChatMessage, type LlmChatInput } from './llm.types';

/**
 * Heuristic stand-in for the model when the API runs without a key (D3.9). It is deterministic
 * and uses plain regular expressions: just enough for the demo to work end to end
 * (search with filters, cite dishes with markers, add to the cart) and to be labelled as demo.
 */
export const DEMO_PREFIX = '(modo demonstração) ';

const MARKER = /\[\[dish:([0-9a-f-]{36})\]\]/gi;
const MAX_CITED = 3;

export function demoPolicy(input: LlmChatInput): FakeTurn {
  const last = input.messages.at(-1);
  if (last?.role === 'tool') return replyToTool(last);
  if (last?.role === 'user') return decide(last.content, input.messages);
  return { text: `${DEMO_PREFIX}Diga o que você quer comer e eu busco opções para você.` };
}

// ---------- deciding what to do with a user message ----------

function decide(message: string, history: ChatMessage[]): FakeTurn {
  const text = normalize(message);
  if (wantsToAdd(text)) {
    const dishId = pickCitedDish(history, text);
    if (dishId) {
      return {
        toolCalls: [
          { name: 'add_to_cart', args: { dish_id: dishId, quantity: extractQuantity(text) } },
        ],
      };
    }
  }
  return { toolCalls: [{ name: 'search_dishes', args: searchArgs(message, text) }] };
}

function wantsToAdd(text: string): boolean {
  return (
    /\b(adiciona\w*|adicione|colocar?|coloca|poe|bota|inclui\w*)\b/.test(text) ||
    /quero\s+(?:esse|essa|este|esta|o\s+(?:primeiro|segundo|terceiro)|a\s+(?:primeira|segunda|terceira))/.test(
      text,
    ) ||
    /\bno carrinho\b/.test(text)
  );
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\bprimeir[oa]\b/, 0],
  [/\bsegund[oa]\b/, 1],
  [/\bterceir[oa]\b/, 2],
];

/** "o primeiro" picks by position in the last assistant message; otherwise the last one cited. */
function pickCitedDish(history: ChatMessage[], text: string): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== 'assistant') continue;
    const ids = [...message.content.matchAll(MARKER)].flatMap((m) => (m[1] ? [m[1]] : []));
    if (ids.length === 0) continue;
    const ordinal = ORDINALS.find(([pattern]) => pattern.test(text));
    return ordinal ? (ids[ordinal[1]] ?? ids.at(-1)) : ids.at(-1);
  }
  return undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function extractQuantity(text: string): number {
  const digits = /\b(\d{1,2})\b/.exec(text)?.[1];
  const word = /\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/.exec(text)?.[1];
  const quantity = digits ? Number(digits) : word ? NUMBER_WORDS[word] : 1;
  return Math.min(10, Math.max(1, quantity ?? 1));
}

// ---------- filters extracted by regular expressions ----------

interface SearchArgs {
  query: string;
  max_price_reais?: number;
  dietary_tags?: DietaryTag[];
  exclude_allergens?: Allergen[];
  max_delivery_minutes?: number;
  category?: DishCategory;
}

const TAG_PATTERNS: Array<[DietaryTag, RegExp]> = [
  ['vegetarian', /vegetarian/],
  ['vegan', /vegan/],
  ['gluten_free', /sem gluten|celiac/],
  ['lactose_free', /sem lactose/],
  ['spicy', /picante|apimentad/],
  ['high_protein', /proteic|proteina/],
  ['light', /\bleves?\b|\blight\b/],
];

const ALLERGEN_WORDS: Array<[Allergen, string]> = [
  ['peanut', 'amendoim'],
  ['nuts', 'castanha|nozes'],
  ['shellfish', 'camarao|frutos do mar|marisco|crustaceo'],
  ['fish', 'peixe'],
  ['egg', 'ovo'],
  ['soy', 'soja'],
  ['gluten', 'gluten'],
  ['lactose', 'lactose'],
];

const CATEGORY_PATTERNS: Array<[DishCategory, RegExp]> = [
  ['DESSERT', /sobremesa|\bdoce\b/],
  ['DRINK', /bebida|suco|refrigerante/],
  ['PIZZA', /pizza/],
  ['SNACK', /lanche|hamburguer|sanduiche/],
  ['STARTER', /entrada|petisco|aperitivo/],
  ['MAIN', /prato principal/],
];

const PRICE_PATTERNS = [
  /(?:ate|menos de|abaixo de|no maximo|maximo de)\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\b(?!\s*(?:min|h\b|hora))/,
  /r\$\s*(\d+(?:[.,]\d{1,2})?)/,
  /(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)\b/,
];

/** What "barato" means in demo mode when the user gives no explicit price. */
const CHEAP_PRICE_REAIS = 25;

function searchArgs(message: string, text: string): SearchArgs {
  const args: SearchArgs = { query: message.trim().slice(0, 200) };

  for (const pattern of PRICE_PATTERNS) {
    const value = pattern.exec(text)?.[1];
    if (value) {
      const price = Number(value.replace(',', '.'));
      if (price > 0) {
        args.max_price_reais = price;
        break;
      }
    }
  }

  if (args.max_price_reais === undefined && /\b(?:barat\w*|em conta)\b/.test(text)) {
    args.max_price_reais = CHEAP_PRICE_REAIS;
  }

  const minutes = /(\d+)\s*(?:min|minutos)\b/.exec(text)?.[1];
  if (minutes && Number(minutes) > 0) args.max_delivery_minutes = Number(minutes);
  else if (/meia hora/.test(text)) args.max_delivery_minutes = 30;

  const tags = new Set<DietaryTag>();
  for (const [tag, pattern] of TAG_PATTERNS) if (pattern.test(text)) tags.add(tag);

  const allergens = new Set<Allergen>();
  for (const [allergen, words] of ALLERGEN_WORDS) {
    const negation = new RegExp(
      `(sem|alergi\\w*(?:\\s+(?:a|ao|as|aos))?|intoleran\\w*(?:\\s+(?:a|ao))?)\\s+(?:o\\s+|a\\s+|os\\s+|as\\s+)?(?:${words})`,
    ).exec(text);
    if (!negation) continue;
    // "sem lactose" / "sem glúten" are dietary tags; "alergia a lactose" is an allergen filter.
    if (negation[1] === 'sem' && allergen === 'gluten') tags.add('gluten_free');
    else if (negation[1] === 'sem' && allergen === 'lactose') tags.add('lactose_free');
    else allergens.add(allergen);
  }

  if (tags.size > 0) args.dietary_tags = [...tags];
  if (allergens.size > 0) args.exclude_allergens = [...allergens];
  const category = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
  if (category) args.category = category;
  return args;
}

// ---------- replying after a tool result ----------

const searchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.string(),
      restaurant: z.object({ name: z.string() }),
    }),
  ),
});
const errorResultSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const addedResultSchema = z.object({
  added: z.object({ name: z.string().nullable(), quantity: z.number() }),
  cart: z.object({ total: z.string() }),
});

function replyToTool(message: Extract<ChatMessage, { role: 'tool' }>): FakeTurn {
  const data: unknown = safeJson(message.content);

  const failure = errorResultSchema.safeParse(data);
  if (failure.success) {
    return { text: `${DEMO_PREFIX}Não consegui concluir: ${failure.data.error.message}` };
  }

  if (message.name === 'search_dishes') {
    const found = searchResultSchema.safeParse(data);
    const results = found.success ? found.data.results.slice(0, MAX_CITED) : [];
    if (results.length === 0) {
      return {
        text:
          `${DEMO_PREFIX}Não encontrei pratos com esses filtros. ` +
          'Que tal aumentar o preço máximo ou afrouxar alguma restrição?',
      };
    }
    const lines = results.map(
      (dish, index) =>
        `${index + 1}. ${dish.name} (${dish.restaurant.name}), ${dish.price} [[dish:${dish.id}]]`,
    );
    return {
      text:
        `${DEMO_PREFIX}Encontrei estas opções para você:\n${lines.join('\n')}\n\n` +
        'Para pedir, diga por exemplo "adiciona o primeiro" ou "quero esse".',
    };
  }

  if (message.name === 'add_to_cart') {
    const added = addedResultSchema.safeParse(data);
    if (added.success) {
      const { name, quantity } = added.data.added;
      return {
        text:
          `${DEMO_PREFIX}Adicionei ${quantity}× ${name ?? 'o prato'} ao carrinho ` +
          `(total ${added.data.cart.total}). Quando estiver pronto, revise e clique em "Finalizar pedido".`,
      };
    }
  }
  return { text: `${DEMO_PREFIX}Pronto! Posso ajudar com mais alguma coisa?` };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
