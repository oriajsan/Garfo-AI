import {
  estimateCostUsd,
  percentile,
  renderMarkdown,
  renderTerminalTable,
  summarize,
  type CaseResult,
  type RunInfo,
} from './report';

const info: RunInfo = {
  provider: 'openai',
  model: 'modelo-x',
  date: '2026-11-16',
  priceInputUsdPerMTok: 0.15,
  priceOutputUsdPerMTok: 0.6,
};

const result = (overrides: Partial<CaseResult>): CaseResult => ({
  id: 'c',
  category: 'simple_filters',
  passed: true,
  checks: [{ name: 'k', passed: true, detail: 'ok' }],
  inputTokens: 1000,
  outputTokens: 100,
  latenciesMs: [100],
  ...overrides,
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('estimateCostUsd', () => {
  it('prices tokens per million', () => {
    expect(estimateCostUsd(1_000_000, 1_000_000, info)).toBeCloseTo(0.75);
    expect(estimateCostUsd(2000, 0, info)).toBeCloseTo(0.0003);
  });
});

describe('summarize and renderMarkdown', () => {
  const results = [
    result({ id: 'a' }),
    result({
      id: 'b',
      category: 'cart_flow',
      passed: false,
      checks: [{ name: 'cartAfter', passed: false, detail: 'expected | got' }],
      latenciesMs: [300, 500],
    }),
  ];

  it('computes the overall rate, per-category rates and averages', () => {
    const s = summarize(results, info);
    expect(s.rate).toBe(0.5);
    expect(s.byCategory).toEqual([
      { category: 'simple_filters', total: 1, passed: 1 },
      { category: 'cart_flow', total: 1, passed: 0 },
    ]);
    expect(s.avgInputTokens).toBe(1000);
    expect(s.latencyP50Ms).toBe(300);
  });

  it('writes the model, the date and escapes pipes in failure details', () => {
    const md = renderMarkdown(results, info);
    expect(md).toContain('1/2 casos (50%)');
    expect(md).toContain('modelo-x');
    expect(md).toContain('expected \\| got');
    expect(md).not.toContain('provedor fake');
  });

  it('labels fake runs clearly and never claims a cost', () => {
    const md = renderMarkdown(results, {
      ...info,
      provider: 'fake',
      model: 'fake (política demo)',
    });
    expect(md).toContain('provedor fake');
    expect(md).toContain('NÃO mede a qualidade do LLM');
    expect(md).toContain('não se aplica');
  });
});

describe('infrastructure cases', () => {
  const mixed = [
    result({ id: 'a' }),
    result({ id: 'b', passed: false }),
    result({ id: 'c', passed: false, infra: true }),
    result({ id: 'd', passed: false, infra: true }),
  ];

  it('excludes infra cases from the agent rate and counts them apart', () => {
    const s = summarize(mixed, info);
    expect(s).toMatchObject({ total: 4, passed: 1, infra: 2, evaluated: 2, rate: 0.5 });
    expect(s.byCategory).toEqual([{ category: 'simple_filters', total: 2, passed: 1 }]);
  });

  it('shows the infrastructure status in the report and in the terminal table', () => {
    const md = renderMarkdown(mixed, info);
    expect(md).toContain('1/2 casos (50%)');
    expect(md).toContain('sem os 2 casos com erro de infraestrutura');
    expect(md).toContain('2 de 4 casos');
    expect(md).toMatch(/`c` \| .* \| infraestrutura \|/);
    expect(renderTerminalTable(mixed)).toContain('INFRA');
  });

  it('is silent about exclusions when nothing is infra', () => {
    expect(renderMarkdown([result({})], info)).not.toContain('sem os');
  });
});
