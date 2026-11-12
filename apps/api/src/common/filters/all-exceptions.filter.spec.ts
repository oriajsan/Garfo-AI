import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { DomainError } from '../domain-error';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown): { status: number; body: unknown } {
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('maps domain errors to their status', () => {
    expect(run(new DomainError('DIFFERENT_RESTAURANT', 'msg', { a: 1 }))).toEqual({
      status: 409,
      body: { error: { code: 'DIFFERENT_RESTAURANT', message: 'msg', details: { a: 1 } } },
    });
  });

  it('maps Zod failures to VALIDATION_ERROR with a readable message', () => {
    const result = z.object({ limit: z.number().max(20) }).safeParse({ limit: 50 });
    if (result.success) throw new Error('expected failure');
    const { status, body } = run(new ZodValidationException(result.error));
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(body)).toContain('limit');
  });

  it('maps Nest HTTP exceptions and unknown routes', () => {
    expect(run(new NotFoundException('nope'))).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
    expect(run(new BadRequestException({ message: ['a', 'b'] }))).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'a; b' } },
    });
  });

  it('keeps the 4xx status of body-parser style errors', () => {
    expect(run({ status: 413, type: 'entity.too.large' })).toMatchObject({ status: 413 });
  });

  it('hides unexpected errors behind INTERNAL_ERROR without a stack', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('secret db detail'));
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});
