import { createHash } from 'node:crypto';
import { VECTOR_DIMENSIONS } from '../config/env';
import { type EmbeddingProvider } from './llm.types';

export const FAKE_EMBEDDING_MODEL_ID = 'fake-lexical-v1';

/** Lowercase, no accents, tokens of 3+ letters/digits (D2.1). */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Deterministic, offline embedding based on feature hashing: every token is hashed (sha256)
 * to one of 1536 positions with a +1/-1 sign, then the vector is L2-normalised. Texts that
 * share words end up close in cosine distance, so search still makes sense without an API key.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = VECTOR_DIMENSIONS;
  readonly modelId = FAKE_EMBEDDING_MODEL_ID;
  /** Lexical cosines are naturally low, so no relevance floor (D2.3). */
  readonly minRelevanceScore = 0;

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    // A text with no usable token still needs a non-zero vector for cosine distance.
    for (const token of tokens.length > 0 ? tokens : ['vazio']) {
      const digest = createHash('sha256').update(token).digest();
      const index = digest.readUInt32BE(0) % this.dimensions;
      vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) & 1 ? 1 : -1);
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    // Opposite signs on a hash collision can cancel out; fall back to a unit vector.
    if (norm === 0) return vector.map((_, i) => (i === 0 ? 1 : 0));
    return vector.map((value) => value / norm);
  }
}
