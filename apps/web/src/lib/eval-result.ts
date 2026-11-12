/**
 * Official result of `pnpm eval` shown on /como-funciona: the single place to update after the
 * real run (the same numbers go to the README and docs/resume-line.md). `XX` means "not measured yet".
 */
export interface EvalResult {
  /** `pending` shows the "waiting for the run" note; switch to `done` once the numbers are real. */
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
  passRate: '90',
  passed: '18',
  total: 20,
  model: 'gemini-3.5-flash-lite (fallback: gemini-3.1-flash-lite)',
  latencyP50Ms: '7.372',
  latencyP95Ms: '27.505',
  costPerConversationUsd: '0 (plano gratuito do Gemini)',
  date: '2026-11-12',
  note: 'Execução oficial de 2026-11-12.',
};
