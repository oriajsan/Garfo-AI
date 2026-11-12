import type { EvalCase } from './schema';

/** Cases selected by `EVAL_ONLY` / `EVAL_REPEAT`; `partial` runs never write `latest.md`. */
export interface Selection {
  cases: Array<{ evalCase: EvalCase; label: string }>;
  partial: boolean;
}

/** `EVAL_ONLY`: comma-separated case ids, validated against the case file. */
export function parseEvalOnly(raw: string | undefined, cases: EvalCase[]): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const known = new Set(cases.map((c) => c.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `EVAL_ONLY contém ids desconhecidos: ${unknown.join(', ')}. ` +
        `Ids válidos: ${[...known].join(', ')}.`,
    );
  }
  return [...new Set(ids)];
}

/** `EVAL_REPEAT`: positive integer, default 1. */
export function parseEvalRepeat(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error(`EVAL_REPEAT inválido: "${raw}". Use um inteiro entre 1 e 100.`);
  }
  return value;
}

export function selectCases(
  cases: EvalCase[],
  onlyRaw: string | undefined,
  repeatRaw: string | undefined,
): Selection {
  const only = parseEvalOnly(onlyRaw, cases);
  const repeat = parseEvalRepeat(repeatRaw);
  if (only === undefined) {
    if (repeat > 1) throw new Error('EVAL_REPEAT só vale junto com EVAL_ONLY.');
    return { cases: cases.map((evalCase) => ({ evalCase, label: evalCase.id })), partial: false };
  }
  const selected: Selection['cases'] = [];
  for (const id of only) {
    const evalCase = cases.find((c) => c.id === id) as EvalCase;
    for (let n = 1; n <= repeat; n++) {
      selected.push({ evalCase, label: repeat > 1 ? `${id}#${n}` : id });
    }
  }
  return { cases: selected, partial: true };
}
