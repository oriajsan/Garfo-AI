import type { EvalCase } from './schema';
import { parseEvalOnly, parseEvalRepeat, selectCases } from './select';

const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as EvalCase[];

describe('parseEvalOnly', () => {
  it('is undefined when empty', () => {
    expect(parseEvalOnly(undefined, cases)).toBeUndefined();
    expect(parseEvalOnly('  ', cases)).toBeUndefined();
  });
  it('parses, trims and dedupes', () => {
    expect(parseEvalOnly('b, a,b', cases)).toEqual(['b', 'a']);
  });
  it('fails clearly on an unknown id', () => {
    expect(() => parseEvalOnly('a,zzz', cases)).toThrow(/EVAL_ONLY.*zzz/);
  });
});

describe('parseEvalRepeat', () => {
  it('defaults to 1 and accepts positive integers', () => {
    expect(parseEvalRepeat(undefined)).toBe(1);
    expect(parseEvalRepeat('3')).toBe(3);
  });
  it.each(['0', '-1', '1.5', 'x'])('rejects %s', (raw) => {
    expect(() => parseEvalRepeat(raw)).toThrow(/EVAL_REPEAT inválido/);
  });
});

describe('selectCases', () => {
  it('runs everything and is not partial without a filter', () => {
    const s = selectCases(cases, undefined, undefined);
    expect(s.partial).toBe(false);
    expect(s.cases.map((c) => c.label)).toEqual(['a', 'b', 'c']);
  });
  it('filters and marks the run as partial', () => {
    const s = selectCases(cases, 'c', undefined);
    expect(s.partial).toBe(true);
    expect(s.cases.map((c) => c.label)).toEqual(['c']);
  });
  it('repeats each filtered case with numbered labels', () => {
    const s = selectCases(cases, 'a,b', '2');
    expect(s.cases.map((c) => c.label)).toEqual(['a#1', 'a#2', 'b#1', 'b#2']);
  });
  it('rejects EVAL_REPEAT without EVAL_ONLY', () => {
    expect(() => selectCases(cases, undefined, '2')).toThrow(/EVAL_ONLY/);
  });
});
