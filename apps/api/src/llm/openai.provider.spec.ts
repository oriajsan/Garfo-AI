import { type OpenAI } from 'openai';
import { VECTOR_DIMENSIONS } from '../config/env';
import { OpenAiEmbeddingProvider, OpenAiLlmProvider } from './openai.provider';

function clientReturning(data: { index: number; embedding: number[] }[]): {
  client: OpenAI;
  create: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ data });
  return { client: { embeddings: { create } } as unknown as OpenAI, create };
}

const vector = (size: number): number[] => new Array<number>(size).fill(0.1);

describe('OpenAiEmbeddingProvider', () => {
  it('sends model and dimensions and returns vectors ordered by index', async () => {
    const first = vector(VECTOR_DIMENSIONS);
    const second = vector(VECTOR_DIMENSIONS).map((n) => n * 2);
    const { client, create } = clientReturning([
      { index: 1, embedding: second },
      { index: 0, embedding: first },
    ]);
    const provider = new OpenAiEmbeddingProvider(client, 'm');
    await expect(provider.embed(['a', 'b'])).resolves.toEqual([first, second]);
    expect(create).toHaveBeenCalledWith({
      model: 'm',
      input: ['a', 'b'],
      dimensions: VECTOR_DIMENSIONS,
    });
  });

  it('fails clearly when a vector has the wrong size', async () => {
    const { client } = clientReturning([{ index: 0, embedding: vector(3072) }]);
    await expect(new OpenAiEmbeddingProvider(client, 'm').embed(['a'])).rejects.toThrow(
      'Embedding model "m" returned a vector with 3072 dimensions, expected 1536 (EMBEDDING_DIMENSIONS). Check LLM_EMBEDDING_MODEL / OPENAI_BASE_URL.',
    );
  });

  it('fails when the number of vectors differs from the inputs', async () => {
    const { client } = clientReturning([{ index: 0, embedding: vector(VECTOR_DIMENSIONS) }]);
    await expect(new OpenAiEmbeddingProvider(client, 'm').embed(['a', 'b'])).rejects.toThrow(
      /1 vectors for 2 inputs/,
    );
  });
});

describe('OpenAiLlmProvider max_tokens', () => {
  async function sentMaxTokens(compatible: boolean): Promise<number> {
    const create = jest.fn().mockResolvedValue((async function* () {})());
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const provider = new OpenAiLlmProvider(client, 'm', compatible);
    for await (const _ of provider.chat({ system: 's', messages: [], tools: [], maxTokens: 800 })) {
      void _;
    }
    return (create.mock.calls[0] as [{ max_tokens: number }])[0].max_tokens;
  }

  it('keeps the configured cap on OpenAI and raises it on compatible endpoints', async () => {
    expect(await sentMaxTokens(false)).toBe(800);
    expect(await sentMaxTokens(true)).toBe(4096);
  });
});
