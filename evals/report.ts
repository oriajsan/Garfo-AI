import { CASE_CATEGORIES, type CaseCategory } from './schema';
import { type CheckResult } from './checks';

export interface CaseResult {
  id: string;
  category: CaseCategory;
  passed: boolean;
  /** Ended with a provider overload/rate limit (429/503): not an agent failure, not counted. */
  infra?: boolean;
  checks: CheckResult[];
  inputTokens: number;
  outputTokens: number;
  /** Latency of each assistant reply of the case, in ms. */
  latenciesMs: number[];
}

export interface RunInfo {
  provider: 'openai' | 'fake';
  /** Chat model id, or a description of the demo policy for the fake provider. */
  model: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  priceInputUsdPerMTok: number;
  priceOutputUsdPerMTok: number;
}

/** Default prices (US$ per million tokens) of a small chat model; override via env, see README. */
export const DEFAULT_PRICE_INPUT_USD_PER_MTOK = 0.15;
export const DEFAULT_PRICE_OUTPUT_USD_PER_MTOK = 0.6;

export const CATEGORY_LABELS: Record<CaseCategory, string> = {
  simple_filters: 'Filtros simples',
  dietary_restrictions: 'Restrições e alergias',
  cart_flow: 'Carrinho em várias mensagens',
  restaurant_conflict: 'Conflito de restaurante',
  no_results: 'Sem resultado',
  out_of_scope: 'Fora do escopo',
  prompt_injection: 'Prompt injection',
};

/** Nearest-rank percentile (p in 0..100). Returns 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  info: Pick<RunInfo, 'priceInputUsdPerMTok' | 'priceOutputUsdPerMTok'>,
): number {
  return (
    (inputTokens * info.priceInputUsdPerMTok + outputTokens * info.priceOutputUsdPerMTok) /
    1_000_000
  );
}

export interface Summary {
  total: number;
  passed: number;
  /** Cases that ended with a provider 429/503 error; excluded from `rate`. */
  infra: number;
  /** Cases the agent was really judged on: `total - infra`. */
  evaluated: number;
  /** passed / evaluated. */
  rate: number;
  byCategory: Array<{ category: CaseCategory; total: number; passed: number }>;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
  costPerCaseUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export function summarize(results: CaseResult[], info: RunInfo): Summary {
  const total = results.length;
  const infra = results.filter((r) => r.infra).length;
  const evaluated = total - infra;
  const passed = results.filter((r) => r.passed && !r.infra).length;
  const inputTokens = results.reduce((sum, r) => sum + r.inputTokens, 0);
  const outputTokens = results.reduce((sum, r) => sum + r.outputTokens, 0);
  const latencies = results.flatMap((r) => r.latenciesMs);
  const totalCostUsd = estimateCostUsd(inputTokens, outputTokens, info);
  return {
    total,
    passed,
    infra,
    evaluated,
    rate: evaluated === 0 ? 0 : passed / evaluated,
    byCategory: CASE_CATEGORIES.map((category) => {
      const own = results.filter((r) => r.category === category && !r.infra);
      return { category, total: own.length, passed: own.filter((r) => r.passed).length };
    }).filter((row) => row.total > 0),
    avgInputTokens: total === 0 ? 0 : inputTokens / total,
    avgOutputTokens: total === 0 ? 0 : outputTokens / total,
    totalCostUsd,
    costPerCaseUsd: total === 0 ? 0 : totalCostUsd / total,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

const pct = (rate: number): string => `${(rate * 100).toFixed(0)}%`;
const usd = (value: number): string => `US$ ${value.toFixed(4)}`;
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export const FAKE_WARNING =
  'Este resultado foi gerado com o provedor fake (política demonstrativa de expressões regulares). ' +
  'Ele valida o harness de avaliação e NÃO mede a qualidade do LLM. O resultado oficial é o `latest.md`.';

/** Markdown written to `latest.md` (real LLM) or `fake-latest.md` (D5.1). */
export function renderMarkdown(results: CaseResult[], info: RunInfo): string {
  const s = summarize(results, info);
  const lines: string[] = [];
  lines.push(
    info.provider === 'fake' ? '# Avaliação do agente (provedor fake)' : '# Avaliação do agente',
  );
  lines.push('');
  if (info.provider === 'fake') lines.push(`> **Aviso:** ${FAKE_WARNING}`, '');
  lines.push(
    `- **Taxa de acerto do agente:** ${s.passed}/${s.evaluated} casos (${pct(s.rate)})` +
      (s.infra > 0 ? `, calculada sem os ${s.infra} casos com erro de infraestrutura` : ''),
    `- **Erros de infraestrutura (429/503 do provedor):** ${s.infra} de ${s.total} casos` +
      (s.infra > 0 ? ' (excluídos da taxa; não são falhas do agente)' : ''),
    `- **Modelo:** ${info.model}`,
    `- **Data:** ${info.date}`,
    `- **Tokens médios por caso:** ${Math.round(s.avgInputTokens)} de entrada, ${Math.round(s.avgOutputTokens)} de saída`,
    info.provider === 'fake'
      ? '- **Custo estimado:** não se aplica (sem chamadas a APIs)'
      : `- **Custo estimado:** ${usd(s.totalCostUsd)} no total, ${usd(s.costPerCaseUsd)} por caso ` +
          `(US$ ${info.priceInputUsdPerMTok}/M tokens de entrada, US$ ${info.priceOutputUsdPerMTok}/M de saída)`,
    `- **Latência por resposta:** p50 ${Math.round(s.latencyP50Ms)} ms, p95 ${Math.round(s.latencyP95Ms)} ms`,
    '',
    '## Acerto por categoria',
    '',
    '| Categoria | Acerto |',
    '| --- | --- |',
    ...s.byCategory.map(
      (row) => `| ${CATEGORY_LABELS[row.category]} | ${row.passed}/${row.total} |`,
    ),
    '',
    '## Acerto por caso',
    '',
    '| Caso | Categoria | Resultado | Detalhe das falhas |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => {
      const failed = r.checks.filter((c) => !c.passed);
      const detail = failed.map((c) => `${c.name}: ${c.detail}`).join('; ');
      return `| \`${r.id}\` | ${CATEGORY_LABELS[r.category]} | ${r.infra ? 'infraestrutura' : r.passed ? 'passou' : 'falhou'} | ${cell(detail)} |`;
    }),
    '',
  );
  return lines.join('\n');
}

/** Plain-text table for the terminal. */
export function renderTerminalTable(results: CaseResult[]): string {
  const idWidth = Math.max(4, ...results.map((r) => r.id.length));
  const rows = results.map((r) => {
    const passedChecks = r.checks.filter((c) => c.passed).length;
    const ms = r.latenciesMs.reduce((a, b) => a + b, 0);
    return `${r.id.padEnd(idWidth)}  ${(r.infra ? 'INFRA' : r.passed ? 'PASS' : 'FAIL').padEnd(5)}  ${`${passedChecks}/${r.checks.length}`.padEnd(5)}  ${String(ms).padStart(6)} ms`;
  });
  return [`${'caso'.padEnd(idWidth)}  res.    checks     tempo`, ...rows].join('\n');
}
