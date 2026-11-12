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
  status: 'pending',
  passRate: 'XX',
  passed: 'XX',
  total: 20,
  model: 'XX',
  latencyP50Ms: 'XX',
  latencyP95Ms: 'XX',
  costPerConversationUsd: 'XX',
  date: 'XX',
  note: 'Aguardando a execução com a chave real da OpenAI.',
};
