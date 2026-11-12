import OpenAI from 'openai';
import { type Env } from '../config/env';
import { FakeEmbeddingProvider } from './fake-embedding.provider';
import { demoPolicy } from './demo-policy';
import { FakeLlmProvider } from './fake-llm.provider';
import { type EmbeddingProvider, type LlmProvider } from './llm.types';
import { OpenAiEmbeddingProvider, OpenAiLlmProvider } from './openai.provider';

/** The provider choice is the only place that reads `LLM_PROVIDER` (env already validated). */
export function createEmbeddingProvider(env: Env): EmbeddingProvider {
  if (env.LLM_PROVIDER === 'fake') return new FakeEmbeddingProvider();
  return new OpenAiEmbeddingProvider(
    new OpenAI({ apiKey: env.OPENAI_API_KEY }),
    env.LLM_EMBEDDING_MODEL as string,
  );
}

export function createLlmProvider(env: Env): LlmProvider {
  if (env.LLM_PROVIDER === 'fake') return new FakeLlmProvider([], demoPolicy);
  return new OpenAiLlmProvider(
    new OpenAI({ apiKey: env.OPENAI_API_KEY }),
    env.LLM_CHAT_MODEL as string,
  );
}
