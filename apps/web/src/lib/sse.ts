import { chatEventSchema, type ChatEvent } from '@garfo/shared';
import { ApiRequestError, NETWORK_ERROR_MESSAGE, sessionHeaders, toApiError } from './api';
import { API_URL } from './env';

/** One SSE frame as it came over the wire, before any validation. */
export interface RawSseEvent {
  event: string;
  data: string;
}

/**
 * Incremental parser for `text/event-stream`. Chunks can cut a line (or a UTF-8 character
 * boundary is handled by the caller's TextDecoder) anywhere, so the unfinished tail of each
 * chunk is kept until the next `push`. A frame ends at a blank line; `:` lines are comments
 * (heartbeats); several `data:` lines of one frame are joined with `\n`.
 */
export class SseParser {
  private buffer = '';
  private eventName = 'message';
  private dataLines: string[] = [];

  push(chunk: string): RawSseEvent[] {
    this.buffer += chunk;
    const events: RawSseEvent[] = [];
    // Lines end with \n, \r\n or a lone \r. A trailing \r may be half of a \r\n, so it waits.
    const lines = this.buffer.split(/\r\n|\n|\r(?=.)/s);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = this.consumeLine(line);
      if (event) events.push(event);
    }
    return events;
  }

  private consumeLine(line: string): RawSseEvent | null {
    if (line === '') {
      if (this.dataLines.length === 0) {
        this.eventName = 'message';
        return null;
      }
      const event = { event: this.eventName, data: this.dataLines.join('\n') };
      this.eventName = 'message';
      this.dataLines = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventName = value;
    else if (field === 'data') this.dataLines.push(value);
    return null;
  }
}

/** Validates a raw frame against the shared schema; unknown or malformed events become null. */
export function toChatEvent(raw: RawSseEvent): ChatEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return null;
  }
  const parsed = chatEventSchema.safeParse({ type: raw.event, data });
  return parsed.success ? parsed.data : null;
}

export interface StreamChatHandlers {
  onEvent: (event: ChatEvent) => void;
}

/**
 * `POST /chat` and consume the SSE response with fetch + ReadableStream (ADR 004: EventSource
 * cannot POST). Resolves when the stream closes; rejects with ApiRequestError for failures
 * before the stream opens (400/429 as JSON) and for network errors. An abort resolves quietly.
 */
export async function streamChat(
  message: string,
  conversationId: string | null,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    throw new ApiRequestError(null, NETWORK_ERROR_MESSAGE, 0);
  }
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiRequestError(null, NETWORK_ERROR_MESSAGE, response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const dispatch = (chunk: string): void => {
    for (const raw of parser.push(chunk)) {
      const event = toChatEvent(raw);
      if (event) handlers.onEvent(event);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dispatch(decoder.decode(value, { stream: true }));
    }
    dispatch(decoder.decode() + '\n\n');
  } catch {
    if (signal?.aborted) return;
    throw new ApiRequestError(null, NETWORK_ERROR_MESSAGE, 0);
  }
}
