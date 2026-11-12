import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CASE_CATEGORIES, EXPECTED_DISTRIBUTION, evalCasesFileSchema } from './schema';

const raw: unknown = JSON.parse(readFileSync(resolve(__dirname, 'cases.json'), 'utf8'));

describe('cases.json', () => {
  it('is valid for the schema (20 cases, unique ids, SPEC distribution)', () => {
    expect(() => evalCasesFileSchema.parse(raw)).not.toThrow();
  });

  it('follows the distribution of SPEC section 8', () => {
    const cases = evalCasesFileSchema.parse(raw);
    for (const category of CASE_CATEGORIES) {
      expect(cases.filter((c) => c.category === category)).toHaveLength(
        EXPECTED_DISTRIBUTION[category],
      );
    }
  });

  it('asks for zero recommendations in no-result and out-of-scope cases', () => {
    const cases = evalCasesFileSchema.parse(raw);
    for (const c of cases.filter((x) =>
      ['no_results', 'out_of_scope', 'prompt_injection'].includes(x.category),
    )) {
      expect(c.expect.maxRecommendations).toBe(0);
    }
  });

  it('rejects an unknown operator, an empty condition and a wrong distribution', () => {
    const cases = evalCasesFileSchema.parse(raw);
    const first = structuredClone(cases);
    first[0]!.expect.toolArgs = [{ tool: 'search_dishes', args: { x: { lt: 3 } as never } }];
    expect(() => evalCasesFileSchema.parse(first)).toThrow();
    const empty = structuredClone(cases);
    empty[0]!.expect.toolArgs = [{ tool: 'search_dishes', args: { x: {} } }];
    expect(() => evalCasesFileSchema.parse(empty)).toThrow();
    const skewed = structuredClone(cases);
    skewed[0]!.category = 'cart_flow';
    expect(() => evalCasesFileSchema.parse(skewed)).toThrow();
  });
});
