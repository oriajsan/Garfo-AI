import { DEMO_PREFIX, demoPolicy } from './demo-policy';
import { type ChatMessage, type LlmChatInput } from './llm.types';

const A = '3b241101-e2bb-4255-8caf-4136c566a962';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const input = (messages: ChatMessage[]): LlmChatInput => ({
  system: 's',
  messages,
  tools: [],
  maxTokens: 10,
});
const user = (content: string): ChatMessage => ({ role: 'user', content });
const searchArgs = (message: string): Record<string, unknown> => {
  const turn = demoPolicy(input([user(message)]));
  expect(turn.toolCalls).toHaveLength(1);
  expect(turn.toolCalls?.[0]?.name).toBe('search_dishes');
  return turn.toolCalls?.[0]?.args as Record<string, unknown>;
};

describe('demoPolicy: searching', () => {
  it('extracts vegetarian and the price ("algo vegetariano até R$ 40")', () => {
    expect(searchArgs('algo vegetariano até R$ 40')).toEqual({
      query: 'algo vegetariano até R$ 40',
      max_price_reais: 40,
      dietary_tags: ['vegetarian'],
    });
  });

  it('extracts prices in several phrasings', () => {
    expect(searchArgs('pizza por 35 reais').max_price_reais).toBe(35);
    expect(searchArgs('um lanche até 25,50').max_price_reais).toBe(25.5);
    expect(searchArgs('algo abaixo de R$ 30').max_price_reais).toBe(30);
  });

  it('extracts delivery time and does not mistake it for price', () => {
    const args = searchArgs('quero algo que chegue em até 30 min');
    expect(args.max_delivery_minutes).toBe(30);
    expect(args.max_price_reais).toBeUndefined();
    expect(searchArgs('chega em meia hora').max_delivery_minutes).toBe(30);
  });

  it('extracts dietary tags', () => {
    expect(searchArgs('algo vegano, sem glúten e sem lactose').dietary_tags).toEqual(
      expect.arrayContaining(['vegan', 'gluten_free', 'lactose_free']),
    );
    expect(searchArgs('um prato picante e proteico').dietary_tags).toEqual([
      'spicy',
      'high_protein',
    ]);
    expect(searchArgs('algo leve').dietary_tags).toEqual(['light']);
  });

  it('extracts allergens ("sem amendoim", "alergia a camarão")', () => {
    expect(searchArgs('sem amendoim por favor').exclude_allergens).toEqual(['peanut']);
    expect(searchArgs('tenho alergia a camarão').exclude_allergens).toEqual(['shellfish']);
    expect(searchArgs('alergia a lactose').exclude_allergens).toEqual(['lactose']);
    expect(searchArgs('sou intolerante a ovo').exclude_allergens).toEqual(['egg']);
  });

  it('extracts the category', () => {
    expect(searchArgs('uma sobremesa').category).toBe('DESSERT');
    expect(searchArgs('quero uma bebida gelada').category).toBe('DRINK');
    expect(searchArgs('pizza').category).toBe('PIZZA');
    expect(searchArgs('um lanche').category).toBe('SNACK');
    expect(searchArgs('uma entrada').category).toBe('STARTER');
    expect(searchArgs('um prato principal').category).toBe('MAIN');
  });

  it('searches with just the query when nothing matches', () => {
    expect(searchArgs('me surpreenda')).toEqual({ query: 'me surpreenda' });
  });
});

describe('demoPolicy: adding to the cart', () => {
  const history: ChatMessage[] = [
    user('algo vegetariano'),
    { role: 'assistant', content: `1. A [[dish:${A}]]\n2. B [[dish:${B}]]` },
  ];

  it('adds the last cited dish for "quero esse"', () => {
    const turn = demoPolicy(input([...history, user('quero esse')]));
    expect(turn.toolCalls?.[0]).toMatchObject({
      name: 'add_to_cart',
      args: { dish_id: B, quantity: 1 },
    });
  });

  it('adds by ordinal and extracts the quantity', () => {
    expect(
      demoPolicy(input([...history, user('adiciona o primeiro')])).toolCalls?.[0]?.args,
    ).toEqual({
      dish_id: A,
      quantity: 1,
    });
    expect(
      demoPolicy(input([...history, user('coloca 2 no carrinho')])).toolCalls?.[0]?.args,
    ).toEqual({
      dish_id: B,
      quantity: 2,
    });
    expect(
      demoPolicy(input([...history, user('adiciona duas')])).toolCalls?.[0]?.args,
    ).toMatchObject({
      quantity: 2,
    });
  });

  it('searches instead when no dish was cited yet', () => {
    const turn = demoPolicy(input([user('quero esse')]));
    expect(turn.toolCalls?.[0]?.name).toBe('search_dishes');
  });
});

describe('demoPolicy: replying after a tool', () => {
  const tool = (name: string, result: unknown): ChatMessage => ({
    role: 'tool',
    toolCallId: 't',
    name,
    content: JSON.stringify(result),
  });
  const dish = (id: string, name: string) => ({
    id,
    name,
    price: 'R$ 10,00',
    restaurant: { name: 'Casa' },
  });

  it('cites up to 3 dishes with name, restaurant, price and a valid marker', () => {
    const results = ['A', 'B', 'C', 'D'].map((n, i) =>
      dish(`3b241101-e2bb-4255-8caf-4136c566a96${i}`, n),
    );
    const turn = demoPolicy(input([user('x'), tool('search_dishes', { results })]));
    expect(turn.text?.startsWith(DEMO_PREFIX)).toBe(true);
    expect(turn.text?.match(/\[\[dish:[0-9a-f-]{36}\]\]/g)).toHaveLength(3);
    expect(turn.text).toContain('A (Casa), R$ 10,00');
    expect(turn.text).not.toContain('D (Casa)');
    expect(turn.toolCalls).toBeUndefined();
  });

  it('explains an empty result', () => {
    const turn = demoPolicy(input([user('x'), tool('search_dishes', { results: [] })]));
    expect(turn.text).toContain('Não encontrei');
    expect(turn.text?.startsWith(DEMO_PREFIX)).toBe(true);
  });

  it('explains a tool error', () => {
    const turn = demoPolicy(
      input([
        user('x'),
        tool('add_to_cart', {
          error: { code: 'DIFFERENT_RESTAURANT', message: 'Carrinho de outro lugar.' },
        }),
      ]),
    );
    expect(turn.text).toBe(`${DEMO_PREFIX}Não consegui concluir: Carrinho de outro lugar.`);
  });

  it('confirms an addition and mentions the checkout button', () => {
    const turn = demoPolicy(
      input([
        user('x'),
        tool('add_to_cart', { added: { name: 'Baião', quantity: 2 }, cart: { total: 'R$ 70,80' } }),
      ]),
    );
    expect(turn.text).toContain('Adicionei 2× Baião');
    expect(turn.text).toContain('Finalizar pedido');
  });

  it('has a generic reply for other tools and an empty conversation', () => {
    expect(demoPolicy(input([user('x'), tool('view_cart', { cart: {} })])).text).toContain(
      DEMO_PREFIX,
    );
    expect(demoPolicy(input([])).text?.startsWith(DEMO_PREFIX)).toBe(true);
    const garbage: ChatMessage = {
      role: 'tool',
      toolCallId: 't',
      name: 'search_dishes',
      content: 'oops',
    };
    expect(demoPolicy(input([garbage])).text).toContain('Não encontrei');
  });
});
