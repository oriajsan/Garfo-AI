import { ERROR_HTTP_STATUS, type ErrorCode } from '@garfo/shared';

/** Business-rule failure. The global filter turns it into `{ error: { code, message } }`. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}
