/**
 * Official result of `pnpm eval` shown on /como-funciona: the single place to update after the
 * real run (the same numbers go to the README and docs/resume-line.md). `XX` means "not measured yet".
 */
export interface EvalResult {
  /** `pending` shows the note as a "waiting for the run" banner; `done` appends it to the pass rate. */
  status: 'pending' | 'done';
  passRate: string;
  passed: string;
  total: number;
  model: string;
  latencyP50Ms: string;
  latencyP95Ms: string;
  costPerConversationUsd: string;
  date: string;
  note: string;
}

export const EVAL_RESULT: EvalResult = {
  status: 'done',
  passRate: '100',
  passed: '20',
  total: 20,
  model: 'gemini-3.5-flash-lite (fallback: gemini-3.1-flash-lite)',
  latencyP50Ms: '9.725',
  latencyP95Ms: '18.392',
  costPerConversationUsd: '0 (plano gratuito do Gemini)',
  date: '2026-11-12',
  note: 'execuções anteriores entre 90% e 95%',
};
