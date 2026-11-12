import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://garfo:garfo@localhost:5432/garfo',
  EMBEDDING_DIMENSIONS: '1536',
  CORS_ORIGIN: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('defaults LLM_PROVIDER to fake without an API key', () => {
    expect(validateEnv({ ...base }).LLM_PROVIDER).toBe('fake');
    expect(validateEnv({ ...base, LLM_PROVIDER: '' }).LLM_PROVIDER).toBe('fake');
  });

  it('defaults LLM_PROVIDER to openai when an API key exists', () => {
    const env = validateEnv({
      ...base,
      OPENAI_API_KEY: 'test-key',
      LLM_CHAT_MODEL: 'chat-model',
      LLM_EMBEDDING_MODEL: 'embedding-model',
    });
    expect(env.LLM_PROVIDER).toBe('openai');
  });

  it('honors an explicit provider and requires openai settings for it', () => {
    expect(validateEnv({ ...base, LLM_PROVIDER: 'fake', OPENAI_API_KEY: 'k' }).LLM_PROVIDER).toBe(
      'fake',
    );
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects wrong embedding dimensions without echoing values', () => {
    expect(() => validateEnv({ ...base, EMBEDDING_DIMENSIONS: '768' })).toThrow(/1536/);
  });

  it('treats an empty OPENAI_BASE_URL as unset and validates it as a URL', () => {
    expect(validateEnv({ ...base }).OPENAI_BASE_URL).toBeUndefined();
    expect(validateEnv({ ...base, OPENAI_BASE_URL: '' }).OPENAI_BASE_URL).toBeUndefined();
    const url = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    expect(validateEnv({ ...base, OPENAI_BASE_URL: url }).OPENAI_BASE_URL).toBe(url);
    expect(() => validateEnv({ ...base, OPENAI_BASE_URL: 'not a url' })).toThrow(/OPENAI_BASE_URL/);
  });
});
