import { validateEnv } from '../src/config/env';
import { type CartService } from '../src/cart/cart.service';
import { type SearchService } from '../src/catalog/search.service';
import { createEmbeddingProvider, createOpenAiClient } from '../src/llm/llm.factory';
import { type ChatMessage, type JsonValue, type ToolCall } from '../src/llm/llm.types';
import { toOpenAiMessages, toOpenAiTools } from '../src/llm/openai.mapping';
import { COMPATIBLE_MIN_MAX_TOKENS } from '../src/llm/openai.provider';
import { buildSystemPrompt } from '../src/prompts/system-prompt';
import { ToolRegistry } from '../src/tools/tool.registry';

/**
 * `pnpm llm:smoke`: one full chat cycle WITHOUT streaming against the configured provider
 * (question -> tool call -> fixed tool result -> final answer), plus one embedding call.
 * It uses the same message mapping and schema sanitiser as production and prints every request
 * and response, with the API key masked. Exits non-zero on any provider error.
 * Never run by the test suite.
 */
const QUESTION = 'Quero algo vegetariano até R$ 40';

/** Plausible fixed result of `search_dishes`; no database involved. */
const FIXED_TOOL_RESULT = {
  count: 2,
  dishes: [
    {
      id: 'smoke-dish-1',
      name: 'Risoto de cogumelos',
      priceCents: 3800,
      restaurant: 'Cantina Bella',
      dietaryTags: ['VEGETARIAN'],
      prepMinutes: 25,
    },
    {
      id: 'smoke-dish-2',
      name: 'Salada Caprese',
      priceCents: 2900,
      restaurant: 'Cantina Bella',
      dietaryTags: ['VEGETARIAN', 'GLUTEN_FREE'],
      prepMinutes: 10,
    },
  ],
};

function show(title: string, value: unknown, apiKey: string): void {
  const text = JSON.stringify(value, null, 2).split(apiKey).join('***');
  console.log(`\n===== ${title} =====\n${text}`);
}

function describeFailure(error: unknown, apiKey: string): string {
  const { status, error: body } = (error ?? {}) as { status?: number; error?: unknown };
  const detail = body === undefined ? '' : `\nbody: ${JSON.stringify(body, null, 2)}`;
  const message = error instanceof Error ? error.message : String(error);
  return `${status === undefined ? '' : `HTTP ${status}: `}${message}${detail}`
    .split(apiKey)
    .join('***');
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  if (env.LLM_PROVIDER !== 'openai') {
    throw new Error('llm:smoke needs LLM_PROVIDER=openai and the provider settings in .env.');
  }
  const apiKey = env.OPENAI_API_KEY as string;
  const model = env.LLM_CHAT_MODEL as string;
  const client = createOpenAiClient(env);
  console.log(`provider base URL: ${client.baseURL}`);
  console.log(`chat model: ${model} | embedding model: ${env.LLM_EMBEDDING_MODEL as string}`);

  // Real search_dishes definition; the registry does not touch its services to build schemas.
  const registry = new ToolRegistry({} as SearchService, {} as CartService);
  const tools = registry.definitions().filter((tool) => tool.name === 'search_dishes');
  const system = buildSystemPrompt({ now: new Date(), cartSummary: 'vazio' });
  const maxTokens =
    env.OPENAI_BASE_URL === undefined ? 800 : Math.max(800, COMPATIBLE_MIN_MAX_TOKENS);

  const history: ChatMessage[] = [{ role: 'user', content: QUESTION }];
  // Same rule as production (D6.14): only compatible endpoints get `reasoning_effort`. If the
  // provider rejects the value, change LLM_REASONING_EFFORT and run this again.
  const reasoning =
    env.OPENAI_BASE_URL === undefined
      ? {}
      : // The SDK types only know low/medium/high.
        { reasoning_effort: env.LLM_REASONING_EFFORT as 'low' };
  if (env.OPENAI_BASE_URL !== undefined) {
    console.log(`reasoning_effort: ${env.LLM_REASONING_EFFORT}`);
  }
  const request = (messages: ChatMessage[], requestModel = model) => ({
    model: requestModel,
    ...reasoning,
    messages: toOpenAiMessages(system, messages),
    tools: toOpenAiTools(tools),
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  const first = request(history);
  show('REQUEST 1 (chat, no stream)', first, apiKey);
  const response1 = await client.chat.completions.create(first);
  show('RESPONSE 1', response1, apiKey);

  const message = response1.choices[0]?.message;
  const rawCalls = message?.tool_calls ?? [];
  if (rawCalls.length === 0) {
    console.log(`\nThe model answered without calling a tool: ${message?.content ?? '(empty)'}`);
    throw new Error('Expected a search_dishes tool call.');
  }
  const toolCalls: ToolCall[] = rawCalls.map((call) => {
    // `extra_content` (Gemini thought signature) is not in the OpenAI types.
    const extra = (call as unknown as { extra_content?: JsonValue }).extra_content;
    return {
      id: call.id,
      name: call.function.name,
      argsJson: call.function.arguments,
      ...(extra !== undefined ? { extraContent: extra } : {}),
    };
  });
  console.log(
    `\ntool calls: ${toolCalls.map((c) => c.name).join(', ')} | extra_content preserved: ${toolCalls.some((c) => c.extraContent !== undefined)}`,
  );

  history.push(
    { role: 'assistant', content: message?.content ?? '', toolCalls },
    ...toolCalls.map((call): ChatMessage => ({
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify(FIXED_TOOL_RESULT),
    })),
  );
  const second = request(history);
  show('REQUEST 2 (chat with tool result)', second, apiKey);
  const response2 = await client.chat.completions.create(second);
  show('RESPONSE 2', response2, apiKey);
  console.log(`\nFINAL ANSWER:\n${response2.choices[0]?.message?.content ?? '(empty)'}`);

  const fallbackModel = env.LLM_FALLBACK_MODEL;
  if (fallbackModel !== undefined) {
    // Risk of the fallback (ADR 006): the history carries the main model's thought signatures
    // and we resend them as received to another model. This request shows whether it accepts.
    const crossModel = request(history, fallbackModel);
    show(`REQUEST 2b (same history, fallback model ${fallbackModel})`, crossModel, apiKey);
    const response2b = await client.chat.completions.create(crossModel);
    show('RESPONSE 2b', response2b, apiKey);
    console.log(
      `\nFALLBACK ANSWER (thought signatures of ${model} accepted by ${fallbackModel}):\n${response2b.choices[0]?.message?.content ?? '(empty)'}`,
    );
  }

  const embedder = createEmbeddingProvider(env);
  const embedRequest = {
    model: embedder.modelId,
    input: ['risoto de cogumelos vegetariano'],
    dimensions: embedder.dimensions,
  };
  show('REQUEST 3 (embeddings)', embedRequest, apiKey);
  const vectors = await embedder.embed(embedRequest.input);
  console.log(
    `\nembedding OK: ${vectors.length} vector(s) of ${vectors[0]?.length ?? 0} dimensions`,
  );
  console.log('\nsmoke test passed');
}

main().catch((error: unknown) => {
  const key = process.env.OPENAI_API_KEY ?? '\u0000';
  console.error(`\nsmoke test FAILED\n${describeFailure(error, key)}`);
  process.exit(1);
});
