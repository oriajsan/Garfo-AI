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
  // The SDK itself falls back to this variable; keep the host environment out of the test.
  beforeAll(() => {
    delete process.env.OPENAI_BASE_URL;
  });

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

describe('llm.factory client options', () => {
  it('disables SDK retries and raises max_tokens only with OPENAI_BASE_URL', () => {
    const client = (provider: unknown): { maxRetries: number } =>
      (provider as { client: { maxRetries: number } }).client;
    expect(client(createLlmProvider(base)).maxRetries).toBe(0);
    expect(client(createEmbeddingProvider(base)).maxRetries).toBe(0);
    const flag = (p: unknown): boolean => (p as { compatibleEndpoint: boolean }).compatibleEndpoint;
    expect(flag(createLlmProvider(base))).toBe(false);
    expect(flag(createLlmProvider({ ...base, OPENAI_BASE_URL: 'https://e.test/v1/' }))).toBe(true);
  });
});

describe('llm.factory call options', () => {
  it('passes reasoning effort, timeout and fallback model to the chat provider', () => {
    const env = {
      ...base,
      LLM_REASONING_EFFORT: 'low',
      LLM_CALL_TIMEOUT_MS: 9000,
      LLM_FALLBACK_MODEL: 'backup',
    } as unknown as Env;
    const options = (createLlmProvider(env) as unknown as { options: unknown }).options;
    expect(options).toEqual({
      reasoningEffort: 'low',
      timeoutMs: 9000,
      fallbackModel: 'backup',
    });
  });
});
