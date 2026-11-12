import { z } from 'zod';

/**
 * Environment variables (SPEC section 9), validated once at startup.
 * The API refuses to boot when a required variable is missing or invalid.
 */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const toNumber = (value: unknown): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

/** Must match the `vector(1536)` column in schema.prisma. */
export const VECTOR_DIMENSIONS = 1536;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((url) => /^postgres(ql)?:\/\//.test(url), 'must be a postgresql:// URL'),
    /** Optional: defaults to `openai` when OPENAI_API_KEY is set, `fake` otherwise (D1.4). */
    LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['openai', 'fake']).optional()),
    OPENAI_API_KEY: optionalString,
    LLM_CHAT_MODEL: optionalString,
    LLM_EMBEDDING_MODEL: optionalString,
    EMBEDDING_DIMENSIONS: z.preprocess(
      toNumber,
      z
        .number()
        .int()
        .refine(
          (n) => n === VECTOR_DIMENSIONS,
          `must be ${VECTOR_DIMENSIONS} (vector column size)`,
        ),
    ),
    CORS_ORIGIN: z.string().min(1),
    MAX_DAILY_CHAT_REQUESTS: z.preprocess(toNumber, z.number().int().positive().default(500)),
    PORT: z.preprocess(toNumber, z.number().int().positive().default(3001)),
  })
  .transform((env) => ({
    ...env,
    LLM_PROVIDER:
      env.LLM_PROVIDER ?? (env.OPENAI_API_KEY ? ('openai' as const) : ('fake' as const)),
  }))
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER !== 'openai') return;
    for (const key of ['OPENAI_API_KEY', 'LLM_CHAT_MODEL', 'LLM_EMBEDDING_MODEL'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'required when LLM_PROVIDER=openai',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses `source` and throws a readable error that never echoes variable values. */
export function validateEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return result.data;
}
