/** pgvector text format: `[0.1,0.2,...]`, bound as a parameter and cast with `::vector`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
