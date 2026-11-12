import {
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { type Request } from 'express';
import { z } from 'zod';
import { DomainError } from './domain-error';

export const SESSION_HEADER = 'x-session-id';
const sessionIdSchema = z.string().uuid();

type SessionRequest = Request & { sessionId?: string };

/** Requires a UUID in `X-Session-Id` and exposes it to handlers (anonymous sessions, SPEC 4). */
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const parsed = sessionIdSchema.safeParse(request.header(SESSION_HEADER));
    if (!parsed.success) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'O header X-Session-Id deve conter um UUID válido.',
      );
    }
    request.sessionId = parsed.data;
    return true;
  }
}

/** Parameter decorator: the session id validated by `SessionGuard`. */
export const SessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const sessionId = context.switchToHttp().getRequest<SessionRequest>().sessionId;
    if (!sessionId) throw new Error('SessionId used without SessionGuard');
    return sessionId;
  },
);
