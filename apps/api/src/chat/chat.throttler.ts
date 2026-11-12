import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { type Request } from 'express';
import { DomainError } from '../common/domain-error';
import { SESSION_HEADER } from '../common/session.guard';

export const CHAT_RATE_LIMIT = 15;
export const CHAT_RATE_WINDOW_MS = 60_000;

/** Two named throttlers, same limit, different tracker: one per IP and one per session. */
export const chatThrottlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'ip',
      limit: CHAT_RATE_LIMIT,
      ttl: CHAT_RATE_WINDOW_MS,
      getTracker: (req: Record<string, unknown>) => String((req as unknown as Request).ip),
    },
    {
      name: 'session',
      limit: CHAT_RATE_LIMIT,
      ttl: CHAT_RATE_WINDOW_MS,
      getTracker: (req: Record<string, unknown>) =>
        String((req as unknown as Request).header(SESSION_HEADER)),
    },
  ],
};

/** Used only on `POST /chat` (never registered globally). Answers in the standard error format. */
@Injectable()
export class ChatThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(): Promise<void> {
    throw new DomainError(
      'RATE_LIMITED',
      'Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo.',
    );
  }
}
