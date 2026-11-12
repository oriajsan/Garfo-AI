import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { AppModule } from '../apps/api/src/app.module';
import { CartService } from '../apps/api/src/cart/cart.service';
import { AgentService } from '../apps/api/src/chat/agent.service';
import { ConversationRepository } from '../apps/api/src/chat/conversation.repository';
import { ConfigService } from '../apps/api/src/config/config.service';
import { validateEnv } from '../apps/api/src/config/env';
import { createEmbeddingProvider, createLlmProvider } from '../apps/api/src/llm/llm.factory';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from '../apps/api/src/llm/llm.tokens';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';
import { collectDishRefs } from '../apps/api/src/tools/tool.format';
import {
  dishViolations,
  evaluateCase,
  isInfrastructureFailure,
  type DishFacts,
  type Observation,
  type RunFailure,
} from './checks';
import {
  DEFAULT_PRICE_INPUT_USD_PER_MTOK,
  DEFAULT_PRICE_OUTPUT_USD_PER_MTOK,
  FAKE_WARNING,
  PARTIAL_WARNING,
  renderMarkdown,
  renderTerminalTable,
  summarize,
  type CaseResult,
  type RunInfo,
} from './report';
import {
  discountWait,
  PacedEmbeddingProvider,
  PacedLlmProvider,
  parseEvalDelayMs,
  RateGate,
} from './rate-gate';
import { selectCases } from './select';
import { evalCasesFileSchema, type EvalCase } from './schema';

/**
 * `pnpm eval`: boots the Nest context (no HTTP), runs every case straight through
 * `AgentService` with a fresh anonymous session, and turns each expectation into a check
 * computed by code (no LLM as judge). See evals/README in docs and SPEC section 8.
 */
const TURN_TIMEOUT_MS = 90_000;
const MARKER = /\[\[dish:([^\]]*)\]\]/g;

const priceSchema = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    z.coerce.number().nonnegative().default(fallback),
  );

function loadCases(): EvalCase[] {
  const raw: unknown = JSON.parse(readFileSync(resolve(__dirname, 'cases.json'), 'utf8'));
  return evalCasesFileSchema.parse(raw);
}

function describeRun(): RunInfo {
  const env = validateEnv(process.env);
  const provider = env.LLM_PROVIDER;
  return {
    provider,
    model: provider === 'openai' ? (env.LLM_CHAT_MODEL ?? 'desconhecido') : 'fake (política demo)',
    date: new Date().toISOString().slice(0, 10),
    priceInputUsdPerMTok: priceSchema(DEFAULT_PRICE_INPUT_USD_PER_MTOK).parse(
      process.env.EVAL_PRICE_INPUT_USD_PER_MTOK,
    ),
    priceOutputUsdPerMTok: priceSchema(DEFAULT_PRICE_OUTPUT_USD_PER_MTOK).parse(
      process.env.EVAL_PRICE_OUTPUT_USD_PER_MTOK,
    ),
  };
}

function printBanner(info: RunInfo, caseCount: number, delayMs: number): void {
  if (info.partial) {
    console.log(`ATENÇÃO: ${PARTIAL_WARNING}\n`);
  }
  console.log('Garfo AI: avaliação do agente');
  console.log(`  Provedor: ${info.provider}`);
  console.log(`  Modelo:   ${info.model}`);
  console.log(`  Casos:    ${caseCount}`);
  console.log(`  Pausa entre chamadas ao provedor: ${delayMs} ms (EVAL_DELAY_MS)`);
  if (info.provider === 'openai') {
    console.log('');
    console.log('  ATENÇÃO: LLM_PROVIDER=openai. Esta execução chama a API real e TEM CUSTO.');
    console.log(
      `  Preços usados na estimativa: US$ ${info.priceInputUsdPerMTok}/M tokens de entrada, ` +
        `US$ ${info.priceOutputUsdPerMTok}/M de saída (EVAL_PRICE_*).`,
    );
  } else {
    console.log('');
    console.log(`  Aviso: ${FAKE_WARNING}`);
  }
  console.log('');
}

/** Catalog statistics per filtered case: a case that eliminates nothing is a weak case. */
function printCatalogStats(cases: EvalCase[], catalog: DishFacts[]): void {
  console.log('Pratos do banco por caso (passam / eliminados pelos filtros do caso):');
  for (const evalCase of cases) {
    const rule = evalCase.expect.recommendedDishesSatisfy;
    if (!rule) continue;
    const passing = catalog.filter((dish) => dishViolations(dish, rule).length === 0).length;
    const eliminated = catalog.length - passing;
    const impossible = evalCase.category === 'no_results';
    let note = '';
    if (impossible && passing > 0) note = '  <- AVISO: caso "sem resultado" com pratos que passam';
    else if (!impossible && passing === 0) note = '  <- AVISO: nenhum prato passa nos filtros';
    else if (eliminated === 0) note = '  <- AVISO: caso fraco, nada é eliminado';
    console.log(
      `  ${evalCase.id.padEnd(34)} passam ${String(passing).padStart(2)} / eliminados ${String(eliminated).padStart(2)} (de ${catalog.length})${note}`,
    );
  }
  console.log('');
}

interface Services {
  agent: AgentService;
  conversations: ConversationRepository;
  carts: CartService;
  prisma: PrismaService;
}

async function runCase(
  evalCase: EvalCase,
  services: Services,
  catalog: ReadonlyMap<string, DishFacts>,
  gate: RateGate,
  label: string,
): Promise<CaseResult> {
  const { agent, conversations, carts, prisma } = services;
  const sessionId = randomUUID();
  const runErrors: string[] = [];
  const failure: RunFailure = { errorCodes: [], httpStatuses: [] };
  const cardIdsPerReply: string[][] = [];
  const cartDishIdsPerTurn: string[][] = [];
  const latenciesMs: number[] = [];
  const callsBefore = gate.calls;
  let finalReplyText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const conversationId = await conversations.resolve(sessionId);
    for (const message of evalCase.input) {
      const cards = new Set<string>();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
      let done = false;
      const waitedBefore = gate.waitedMs;
      try {
        await agent.run(
          { sessionId, conversationId, message },
          (event) => {
            if (event.type === 'dish_cards') for (const d of event.data.dishes) cards.add(d.id);
            else if (event.type === 'error') {
              failure.errorCodes.push(event.data.code);
              runErrors.push(`${event.data.code}: ${event.data.message}`);
            } else if (event.type === 'done') {
              done = true;
              inputTokens += event.data.usage.inputTokens;
              outputTokens += event.data.usage.outputTokens;
              // The gate's pacing sleeps happen inside the turn: not agent latency.
              latenciesMs.push(discountWait(event.data.latencyMs, gate.waitedMs - waitedBefore));
            }
          },
          abort.signal,
        );
      } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        if (typeof status === 'number') failure.httpStatuses.push(status);
        runErrors.push(error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timer);
      }
      if (!done && runErrors.length === 0) runErrors.push('turn did not finish (timeout)');
      cardIdsPerReply.push([...cards]);
      const turnCart = await carts.getCart(sessionId);
      cartDishIdsPerTurn.push(turnCart.items.map((item) => item.dishId));
      if (runErrors.length > 0) break;
    }

    // What the model really asked for lives in the persisted rows (assistant toolCalls).
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const toolCalls: Observation['toolCalls'] = [];
    const seen = new Map<string, string>();
    const cited: string[] = [];
    let lastTurnTexts: string[] = [];
    for (const row of rows) {
      const content = row.content as Record<string, unknown>;
      if (row.role === 'USER') lastTurnTexts = [];
      if (row.role === 'ASSISTANT') {
        const calls = Array.isArray(content.toolCalls) ? content.toolCalls : [];
        for (const call of calls as Array<{ name: string; argsJson: string }>) {
          toolCalls.push({ name: call.name, args: safeParse(call.argsJson) });
        }
        const text = typeof content.text === 'string' ? content.text : '';
        if (text) lastTurnTexts.push(text);
        for (const match of text.matchAll(MARKER)) cited.push(match[1] ?? '');
      } else if (row.role === 'TOOL') {
        collectDishRefs(content.result, seen);
      }
    }

    const cart = await carts.getCart(sessionId);
    const dishRestaurants = new Map(
      (
        await prisma.dish.findMany({
          where: { id: { in: [...new Set(cartDishIdsPerTurn.flat())] } },
          select: { id: true, restaurantId: true },
        })
      ).map((d) => [d.id, d.restaurantId]),
    );
    const observation: Observation = {
      toolCalls,
      cardIdsPerReply,
      dishes: catalog,
      cartItems: cart.items.map((item) => ({ dishName: item.name, quantity: item.quantity })),
      cartRestaurantIdsPerTurn: cartDishIdsPerTurn.map((ids) =>
        ids.map((id) => dishRestaurants.get(id) ?? `unknown:${id}`),
      ),
      finalReplyText: lastTurnTexts.join('\n'),
      hallucinatedIds: [...new Set(cited.filter((id) => !seen.has(id)))],
      runErrors,
    };
    finalReplyText = observation.finalReplyText;
    const outcome = evaluateCase(evalCase, observation);
    const callsAfter = gate.calls;
    return {
      id: label,
      category: evalCase.category,
      passed: outcome.passed,
      infra: isInfrastructureFailure(failure),
      checks: outcome.checks,
      inputTokens,
      outputTokens,
      latenciesMs,
      chatCalls: callsAfter.chat - callsBefore.chat,
      embedCalls: callsAfter.embed - callsBefore.embed,
      finalReplyText,
    };
  } finally {
    await prisma.conversation.deleteMany({ where: { sessionId } });
    await prisma.cart.deleteMany({ where: { sessionId } });
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const allCases = loadCases();
  const selection = selectCases(allCases, process.env.EVAL_ONLY, process.env.EVAL_REPEAT);
  const info = { ...describeRun(), partial: selection.partial };
  const delayMs = parseEvalDelayMs(process.env.EVAL_DELAY_MS, info.provider);
  printBanner(info, selection.cases.length, delayMs);

  // One gate shared by chat and embeddings, wrapping the production providers (their 429/503
  // retry stays underneath). Only the eval is paced; the API code is untouched.
  const gate = new RateGate(delayMs);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService) =>
        new PacedLlmProvider(createLlmProvider(config.all()), gate),
    })
    .overrideProvider(EMBEDDING_PROVIDER)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService) =>
        new PacedEmbeddingProvider(createEmbeddingProvider(config.all()), gate),
    })
    .compile();
  await moduleRef.init();
  try {
    const services: Services = {
      agent: moduleRef.get(AgentService),
      conversations: moduleRef.get(ConversationRepository),
      carts: moduleRef.get(CartService),
      prisma: moduleRef.get(PrismaService),
    };

    const dishes = await services.prisma.dish.findMany({ include: { restaurant: true } });
    const catalog = new Map<string, DishFacts>(
      dishes.map((dish) => [
        dish.id,
        {
          id: dish.id,
          name: dish.name,
          priceCents: dish.priceCents,
          dietaryTags: dish.dietaryTags,
          allergens: dish.allergens,
          category: dish.category,
          available: dish.available,
          restaurantOpen: dish.restaurant.isOpen,
          deliveryMaxMinutes: dish.restaurant.deliveryMaxMinutes,
        },
      ]),
    );
    if (catalog.size === 0) throw new Error('The catalog is empty: run `pnpm db:setup` first.');
    // Statistics consider only dishes a customer could actually order.
    printCatalogStats([...new Set(selection.cases.map((c) => c.evalCase))], [...catalog.values()]);

    const results: CaseResult[] = [];
    for (const [index, { evalCase, label }] of selection.cases.entries()) {
      process.stdout.write(`[${index + 1}/${selection.cases.length}] ${label} ... `);
      const result = await runCase(evalCase, services, catalog, gate, label);
      results.push(result);
      console.log(
        result.infra ? 'INFRA (provedor sobrecarregado)' : result.passed ? 'ok' : 'FALHOU',
      );
    }

    console.log('');
    console.log(renderTerminalTable(results));
    const failures = results.filter((r) => !r.passed && !r.infra);
    if (failures.length > 0) {
      console.log('\nFalhas:');
      for (const r of failures) {
        console.log(`  ${r.id}`);
        for (const check of r.checks.filter((c) => !c.passed)) {
          console.log(`    - ${check.name}: ${check.detail}`);
        }
      }
    }

    const summary = summarize(results, info);
    console.log('');
    console.log(
      `Acerto do agente: ${summary.passed}/${summary.evaluated} (${(summary.rate * 100).toFixed(0)}%)`,
    );
    console.log(
      `Erros de infraestrutura (429/503): ${summary.infra} de ${summary.total} casos` +
        (summary.infra > 0 ? ' (excluídos da taxa)' : ''),
    );
    for (const row of summary.byCategory)
      console.log(`  ${row.category}: ${row.passed}/${row.total}`);
    console.log(
      `Tokens médios por caso: ${Math.round(summary.avgInputTokens)} entrada, ${Math.round(summary.avgOutputTokens)} saída`,
    );
    console.log(
      info.provider === 'fake'
        ? 'Custo estimado: não se aplica (provedor fake)'
        : `Custo estimado: US$ ${summary.totalCostUsd.toFixed(4)}`,
    );
    console.log(
      `Chamadas ao LLM por caso (média): ${summary.avgChatCalls.toFixed(1)} de chat, ${summary.avgEmbedCalls.toFixed(1)} de embeddings`,
    );
    console.log(
      `Latência por resposta (sem a pausa): p50 ${Math.round(summary.latencyP50Ms)} ms, p95 ${Math.round(summary.latencyP95Ms)} ms`,
    );

    // Neither the fake provider (D5.1) nor a filtered run ever touches latest.md.
    const fileName = info.partial
      ? 'partial-latest.md'
      : info.provider === 'fake'
        ? 'fake-latest.md'
        : 'latest.md';
    const outDir = resolve(__dirname, 'results');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, fileName), renderMarkdown(results, info), 'utf8');
    console.log(`\nRelatório gravado em evals/results/${fileName}`);
    if (info.provider === 'fake') console.log(`Aviso: ${FAKE_WARNING}`);
  } finally {
    await moduleRef.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
