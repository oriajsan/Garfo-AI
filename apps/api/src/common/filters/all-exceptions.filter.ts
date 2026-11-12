import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { type ApiError, type ErrorCode } from '@garfo/shared';
import { type Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { type ZodIssue } from 'zod';
import { DomainError } from '../domain-error';

/** Turns any thrown value into `{ error: { code, message } }`, never leaking a stack trace. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: error(exception.code, exception.message, exception.details),
      };
    }
    if (exception instanceof ZodValidationException) {
      return {
        status: 400,
        body: error('VALIDATION_ERROR', describeZodError(exception.getZodError())),
      };
    }
    if (exception instanceof HttpException) {
      return fromStatus(exception.getStatus(), httpMessage(exception));
    }
    // body-parser errors (invalid JSON, payload too large) carry a 4xx `status` of their own.
    const status = statusOf(exception);
    if (status !== undefined && status >= 400 && status < 500) {
      return fromStatus(
        status,
        status === 413 ? 'Corpo da requisição grande demais.' : 'Requisição inválida.',
      );
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    return {
      status: 500,
      body: error('INTERNAL_ERROR', 'Erro interno. Tente novamente em instantes.'),
    };
  }
}

function error(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

function fromStatus(status: number, message: string): { status: number; body: ApiError } {
  if (status === 404) return { status, body: error('NOT_FOUND', message) };
  if (status === 429) return { status, body: error('RATE_LIMITED', message) };
  if (status >= 500) return { status, body: error('INTERNAL_ERROR', 'Erro interno.') };
  return { status, body: error('VALIDATION_ERROR', message) };
}

function httpMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}

function statusOf(value: unknown): number | undefined {
  if (typeof value === 'object' && value !== null && 'status' in value) {
    const status = value.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/** "campo: mensagem; outro: mensagem", readable in a toast or a curl. */
export function describeZodError(zodError: unknown): string {
  const issues = (zodError as { issues?: ZodIssue[] }).issues ?? [];
  if (issues.length === 0) return 'Dados inválidos.';
  return issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
