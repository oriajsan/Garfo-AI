import { type Env } from '../config/env';
import { createEmbeddingProvider, createLlmProvider } from './llm.factory';

const base = {
  LLM_PROVIDER: 'openai',
  OPENAI_API_KEY: 'test-key',
  LLM_CHAT_MODEL: 'chat',
  LLM_EMBEDDING_MODEL: 'embed',
} as unknown as Env;

const clientOf = (provider: unknown): { baseURL: string } =>
  (provider as { client: { baseURL: string } }).client;

describe('llm.factory baseURL', () => {
  it('uses the OpenAI default without OPENAI_BASE_URL', () => {
    expect(clientOf(createLlmProvider(base)).baseURL).toBe('https://api.openai.com/v1');
    expect(clientOf(createEmbeddingProvider(base)).baseURL).toBe('https://api.openai.com/v1');
  });

  it('passes OPENAI_BASE_URL to both clients', () => {
    const env = { ...base, OPENAI_BASE_URL: 'https://example.test/v1beta/openai/' } as Env;
    expect(clientOf(createLlmProvider(env)).baseURL).toBe('https://example.test/v1beta/openai/');
    expect(clientOf(createEmbeddingProvider(env)).baseURL).toBe(
      'https://example.test/v1beta/openai/',
    );
  });
});
