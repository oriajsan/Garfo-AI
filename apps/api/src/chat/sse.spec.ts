import { type Response } from 'express';
import { formatSseEvent, HEARTBEAT_FRAME, SseStream } from './sse';

describe('SSE formatting', () => {
  it('writes `event:` and a one-line `data:` JSON', () => {
    expect(formatSseEvent({ type: 'token', data: { text: 'linha 1\nlinha 2' } })).toBe(
      'event: token\ndata: {"text":"linha 1\\nlinha 2"}\n\n',
    );
  });
});

describe('SseStream', () => {
  function fakeResponse() {
    const written: string[] = [];
    const headers: Record<string, string> = {};
    const res: { writableEnded: boolean; [key: string]: unknown } = {
      writableEnded: false,
      destroyed: false,
      status: jest.fn(),
      setHeader: (k: string, v: string) => (headers[k] = v),
      flushHeaders: jest.fn(),
      write: (chunk: string) => written.push(chunk),
      end: jest.fn(() => {
        res.writableEnded = true;
      }),
    };
    return { res, written, headers };
  }

  afterEach(() => jest.useRealTimers());

  it('sets the streaming headers, sends heartbeats and stops on close', () => {
    jest.useFakeTimers();
    const { res, written, headers } = fakeResponse();
    const stream = new SseStream(res as unknown as Response);
    stream.open(1000);

    expect(headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(res.flushHeaders).toHaveBeenCalled();

    jest.advanceTimersByTime(2500);
    expect(written).toEqual([HEARTBEAT_FRAME, HEARTBEAT_FRAME]);

    stream.send({ type: 'meta', data: { conversationId: 'c' } });
    stream.close();
    jest.advanceTimersByTime(5000);
    expect(written).toHaveLength(3);
    stream.send({ type: 'token', data: { text: 'late' } });
    expect(written).toHaveLength(3);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
