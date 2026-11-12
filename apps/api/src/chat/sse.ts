import { type ChatEvent } from '@garfo/shared';
import { type Response } from 'express';

export const HEARTBEAT_INTERVAL_MS = 15_000;

/** One SSE frame: `event: <type>\ndata: <json>\n\n`. Newlines in JSON are escaped, so one line. */
export function formatSseEvent(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export const HEARTBEAT_FRAME = ': ping\n\n';

/** Writes SSE frames straight to the Express response (SPEC section 6). */
export class SseStream {
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(private readonly res: Response) {}

  open(heartbeatMs: number = HEARTBEAT_INTERVAL_MS): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
    this.heartbeat = setInterval(() => this.write(HEARTBEAT_FRAME), heartbeatMs);
  }

  send(event: ChatEvent): void {
    this.write(formatSseEvent(event));
  }

  close(): void {
    clearInterval(this.heartbeat);
    if (!this.res.writableEnded) this.res.end();
  }

  private write(frame: string): void {
    if (this.res.writableEnded || this.res.destroyed) return;
    this.res.write(frame);
  }
}
