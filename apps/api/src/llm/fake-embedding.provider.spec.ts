import { FakeEmbeddingProvider, tokenize } from './fake-embedding.provider';

const cosine = (a: number[], b: number[]): number =>
  a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

describe('FakeEmbeddingProvider', () => {
  const provider = new FakeEmbeddingProvider();

  it('produces deterministic unit vectors of 1536 dimensions', async () => {
    const [a] = await provider.embed(['Pizza de queijo']);
    const [b] = await provider.embed(['Pizza de queijo']);
    expect(a).toHaveLength(1536);
    expect(a).toEqual(b);
    expect(Math.sqrt(cosine(a ?? [], a ?? []))).toBeCloseTo(1, 10);
  });

  it('ignores case and accents', async () => {
    const [a, b] = await provider.embed(['Feijão Tropeiro', 'FEIJAO TROPEIRO']);
    expect(cosine(a ?? [], b ?? [])).toBeCloseTo(1, 10);
  });

  it('puts texts that share words closer than unrelated texts', async () => {
    const [query, related, unrelated] = await provider.embed([
      'sushi de salmão',
      'Combo de sushi com salmão fresco',
      'Brigadeiro de colher com chocolate',
    ]);
    expect(cosine(query ?? [], related ?? [])).toBeGreaterThan(
      cosine(query ?? [], unrelated ?? []),
    );
  });

  it('never returns a zero vector, even for text without tokens', async () => {
    const [vector] = await provider.embed(['', 'a b']);
    expect(Math.sqrt(cosine(vector ?? [], vector ?? []))).toBeCloseTo(1, 10);
  });

  it('exposes metadata', () => {
    expect(provider.modelId).toBe('fake-lexical-v1');
    expect(provider.minRelevanceScore).toBe(0);
    expect(provider.dimensions).toBe(1536);
  });

  it('tokenizes into 3+ letter lowercase words without accents', () => {
    expect(tokenize('Pão de Açaí, 2x!')).toEqual(['pao', 'acai']);
  });
});
