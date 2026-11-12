import OpenAI from 'openai';
import { type Env } from '../config/env';
import { FakeEmbeddingProvider } from './fake-embedding.provider';
import { createDiagnosticFetch } from './http-diagnostics';
import { demoPolicy } from './demo-policy';
import { FakeLlmProvider } from './fake-llm.provider';
import { type EmbeddingProvider, type LlmProvider } from './llm.types';
import { OpenAiEmbeddingProvider, OpenAiLlmProvider } from './openai.provider';

/** `OPENAI_BASE_URL` (optional) points the same SDK at an OpenAI-compatible endpoint. */
export function createOpenAiClient(env: Env): OpenAI {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    // Retries are ours (429/503 only, with logs); the SDK's own are off.
    maxRetries: 0,
    fetch: createDiagnosticFetch(),
  });
}

/** The provider choice is the only place that reads `LLM_PROVIDER` (env already validated). */
export function createEmbeddingProvider(env: Env): EmbeddingProvider {
  if (env.LLM_PROVIDER === 'fake') return new FakeEmbeddingProvider();
  return new OpenAiEmbeddingProvider(createOpenAiClient(env), env.LLM_EMBEDDING_MODEL as string);
}

export function createLlmProvider(env: Env): LlmProvider {
  if (env.LLM_PROVIDER === 'fake') return new FakeLlmProvider([], demoPolicy);
  return new OpenAiLlmProvider(
    createOpenAiClient(env),
    env.LLM_CHAT_MODEL as string,
    env.OPENAI_BASE_URL !== undefined,
  );
}
