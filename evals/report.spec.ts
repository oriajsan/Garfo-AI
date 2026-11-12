import {
  estimateCostUsd,
  percentile,
  renderReplyBlock,
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
  chatCalls: 2,
  embedCalls: 1,
  retries: 0,
  retryWaitMs: 0,
  timeouts: 0,
  fallbacks: 0,
  truncations: 0,
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

describe('LLM calls per case', () => {
  const rs = [
    result({ id: 'a', chatCalls: 3, embedCalls: 1 }),
    result({ id: 'b', chatCalls: 1, embedCalls: 0 }),
  ];

  it('averages chat and embedding calls in the summary and the report', () => {
    const s = summarize(rs, info);
    expect(s.avgChatCalls).toBe(2);
    expect(s.avgEmbedCalls).toBe(0.5);
    const md = renderMarkdown(rs, info);
    expect(md).toContain('2.0 de chat, 0.5 de embeddings');
    expect(md).toMatch(/`a` \| .* \| passou \| 3 \| 1 \|/);
  });

  it('shows the counts in the terminal table', () => {
    expect(renderTerminalTable(rs)).toContain('chat  emb');
    expect(renderTerminalTable(rs).split('\n')[1]).toMatch(
      / {3}3 {2} {2}1 {2} {4}0 {2} {6}0 {2} {7}0 {2} {5}0$/,
    );
  });
});

describe('final replies of failed cases', () => {
  it('lists only failed cases, with the reply in a fence', () => {
    const md = renderMarkdown(
      [
        result({ id: 'ok', finalReplyText: 'segredo-do-ok' }),
        result({ id: 'bad', passed: false, finalReplyText: 'Olá | **mundo**' }),
      ],
      info,
    );
    expect(md).toContain('## Respostas dos casos que falharam');
    expect(md).toContain('Olá | **mundo**');
    expect(md).not.toContain('segredo-do-ok');
  });

  it('omits the section when nothing failed', () => {
    expect(renderMarkdown([result({})], info)).not.toContain('Respostas dos casos');
  });

  it('truncates and uses a fence longer than any backtick run in the text', () => {
    const block = renderReplyBlock('```js\n' + 'x'.repeat(900));
    expect(block.startsWith('````\n')).toBe(true);
    expect(block.endsWith('\n````')).toBe(true);
    expect(block).toContain('[truncado]');
    expect(block.length).toBeLessThan(900);
  });
});

describe('partial runs', () => {
  it('warns in the report banner', () => {
    expect(renderMarkdown([result({})], { ...info, partial: true })).toContain('Execução PARCIAL');
    expect(renderMarkdown([result({})], info)).not.toContain('Execução PARCIAL');
  });
});

describe('retries', () => {
  const rs = [result({ id: 'a', retries: 2, retryWaitMs: 4000 }), result({ id: 'b', retries: 0 })];

  it('totals retries and backoff in the summary and report, per case in the table', () => {
    const s = summarize(rs, info);
    expect(s.totalRetries).toBe(2);
    expect(s.totalRetryWaitMs).toBe(4000);
    const md = renderMarkdown(rs, info);
    expect(md).toContain('2 no total, somando 4000 ms');
    expect(md).toMatch(/`a` \| .* \| passou \| 2 \| 1 \| 2 \|/);
    expect(renderTerminalTable(rs)).toContain('retry');
  });
});

describe('timeouts and fallbacks', () => {
  const rs = [result({ id: 'a', timeouts: 2, fallbacks: 1 }), result({ id: 'b' })];

  it('totals them in the summary and shows columns per case', () => {
    const s = summarize(rs, info);
    expect(s.totalTimeouts).toBe(2);
    expect(s.totalFallbacks).toBe(1);
    const md = renderMarkdown(rs, info);
    expect(md).toContain('| Timeouts | Fallbacks |');
    expect(md).toContain('Timeouts de primeiro chunk:** 2 no total');
    expect(renderTerminalTable(rs)).toContain('timeout  fallback');
  });
});

describe('truncations', () => {
  const rs = [result({ id: 'a', truncations: 2 }), result({ id: 'b' })];

  it('totals them and shows a column per case and a terminal column', () => {
    expect(summarize(rs, info).totalTruncations).toBe(2);
    const md = renderMarkdown(rs, info);
    expect(md).toContain('| Fallbacks | Truncamentos |');
    expect(md).toContain('llm_truncated`):** 2 no total');
    expect(renderTerminalTable(rs)).toContain('trunc.');
  });
});
