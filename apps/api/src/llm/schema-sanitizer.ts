/**
 * Reduces a JSON Schema to a subset that both OpenAI and OpenAI-compatible endpoints
 * (notably Gemini's) accept. Applied to every tool schema, because we never use strict mode.
 * The real validation of tool arguments stays on the server (Zod, in the ToolRegistry).
 */
const KEPT_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'anyOf',
  'nullable',
]);

export type JsonSchema = Record<string, unknown>;

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function sanitizeJsonSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!KEPT_KEYS.has(key)) continue;
    if (key === 'properties' && isObject(value)) {
      // Property names are data, not schema keywords: only the values are sanitized.
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          isObject(child) ? sanitizeJsonSchema(child) : child,
        ]),
      );
    } else if (key === 'items') {
      out[key] = isObject(value) ? sanitizeJsonSchema(value) : value;
    } else if (key === 'anyOf' && Array.isArray(value)) {
      out[key] = (value as unknown[]).map((child) =>
        isObject(child) ? sanitizeJsonSchema(child) : child,
      );
    } else if (key === 'type' && Array.isArray(value)) {
      // draft-7 nullable form: ["string", "null"] -> type "string" + nullable.
      const types = (value as unknown[]).filter((t) => t !== 'null');
      out.type = types.length === 1 ? types[0] : types;
      if (types.length !== value.length) out.nullable = true;
    } else {
      out[key] = value;
    }
  }
  // `const` is not in the whitelist; a single-value enum is equivalent.
  if (!('enum' in out) && 'const' in schema) out.enum = [schema.const];
  return out;
}
