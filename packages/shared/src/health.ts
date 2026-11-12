import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['ok', 'error']),
  /** Active LLM provider; the web shows a demo-mode notice when it is `fake`. */
  llm: z.enum(['openai', 'fake']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
