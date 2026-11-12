import { sanitizeJsonSchema } from './schema-sanitizer';

describe('sanitizeJsonSchema', () => {
  it('drops unsupported keywords at every level and keeps property names', () => {
    const result = sanitizeJsonSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['q'],
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 5, default: 'x', format: 'uuid' },
        price: { type: 'number', exclusiveMinimum: 0, maximum: 9 },
        tags: { type: 'array', items: { type: 'string', enum: ['a'] }, minItems: 1 },
        default: { type: 'string', pattern: '^a' },
      },
    });
    expect(result).toEqual({
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 5 },
        price: { type: 'number', maximum: 9 },
        tags: { type: 'array', items: { type: 'string', enum: ['a'] }, minItems: 1 },
        default: { type: 'string' },
      },
    });
  });

  it('converts nullable type arrays and const', () => {
    expect(
      sanitizeJsonSchema({
        type: 'object',
        properties: { a: { type: ['string', 'null'] }, b: { const: 'x', type: 'string' } },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string', nullable: true },
        b: { type: 'string', enum: ['x'] },
      },
    });
  });

  it('sanitizes inside anyOf and a root-level nullable type array', () => {
    expect(
      sanitizeJsonSchema({
        type: ['object', 'null'],
        anyOf: [
          { type: 'string', format: 'uuid' },
          { type: 'number', exclusiveMinimum: 0 },
        ],
      }),
    ).toEqual({
      type: 'object',
      nullable: true,
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
  });
});
