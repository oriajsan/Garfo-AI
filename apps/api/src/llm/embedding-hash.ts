import { createHash } from 'node:crypto';

/**
 * Fingerprint stored in `Dish.embeddingHash` (D2.2). It includes the model id, so switching
 * from the fake to a real model (or between real models) forces a re-embed.
 */
export function embeddingHash(modelId: string, embeddingText: string): string {
  return createHash('sha256').update(`${modelId}\n${embeddingText}`).digest('hex');
}
