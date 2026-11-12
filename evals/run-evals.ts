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
import { SearchService } from '../apps/api/src/catalog/search.service';
import { ToolRegistry } from '../apps/api/src/tools/tool.registry';
import { dishViolations, type DishFacts } from './checks';
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
import { PacedEmbeddingProvider, PacedLlmProvider, parseEvalDelayMs, RateGate } from './rate-gate';
import { LlmEventCountingLogger } from './llm-event-counter';
import { runCase, type Services } from './run-case';
import { ToolTrace, TracingToolRegistry } from './tool-trace';
import { selectCases } from './select';
import { evalCasesFileSchema, type EvalCase } from './schema';

/**
 * `pnpm eval`: boots the Nest context (no HTTP), runs every case straight through
 * `AgentService` with a fresh anonymous session, and turns each expectation into a check
 * computed by code (no LLM as judge). See evals/README in docs and SPEC section 8.
 */

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

async function main(): Promise<void> {
  const allCases = loadCases();
  const selection = selectCases(allCases, process.env.EVAL_ONLY, process.env.EVAL_REPEAT);
  const info = { ...describeRun(), partial: selection.partial };
  const delayMs = parseEvalDelayMs(process.env.EVAL_DELAY_MS, info.provider);
  printBanner(info, selection.cases.length, delayMs);

  // One gate shared by chat and embeddings, wrapping the production providers (their 429/503
  // retry stays underneath). Only the eval is paced; the API code is untouched.
  const gate = new RateGate(delayMs);
  // `withRetry` logs each 429/503 retry through the Nest Logger; observe it, do not change it.
  const eventLog = new LlmEventCountingLogger();
  const trace = new ToolTrace();
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
    .overrideProvider(ToolRegistry)
    .useFactory({
      inject: [SearchService, CartService],
      factory: (search: SearchService, cart: CartService) =>
        new TracingToolRegistry(search, cart, trace),
    })
    // `compile()` installs Nest's silent TestingLogger over any `overrideLogger` made before it,
    // which swallowed every warning; `setLogger` is what keeps the observer in place.
    .setLogger(eventLog)
    .compile();
  await moduleRef.init();
  try {
    const services: Services & { prisma: PrismaService } = {
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
      const result = await runCase(evalCase, services, catalog, gate, label, eventLog, trace);
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
      `Retries 429/503: ${summary.totalRetries} no total (${Math.round(summary.totalRetryWaitMs)} ms de backoff, dentro da latência)`,
    );
    console.log(
      `Timeouts de primeiro chunk: ${summary.totalTimeouts} no total; fallback usado ${summary.totalFallbacks} vez(es)`,
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
