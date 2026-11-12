import { SseParser, toChatEvent, type RawSseEvent } from './sse';

function parseAll(chunks: string[]): RawSseEvent[] {
  const parser = new SseParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

describe('SseParser', () => {
  it('parses several events in a single chunk', () => {
    const events = parseAll([
      'event: meta\ndata: {"conversationId":"c1"}\n\nevent: token\ndata: {"text":"Oi"}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'meta', data: '{"conversationId":"c1"}' },
      { event: 'token', data: '{"text":"Oi"}' },
    ]);
  });

  it('reassembles an event split between chunks, even in the middle of a field', () => {
    const events = parseAll(['event: tok', 'en\nda', 'ta: {"text":"ol', 'á"}\n', '\n']);
    expect(events).toEqual([{ event: 'token', data: '{"text":"olá"}' }]);
  });

  it('handles one-character chunks and CRLF line endings', () => {
    const raw = 'event: token\r\ndata: {"text":"a"}\r\n\r\n';
    const events = parseAll(raw.split(''));
    expect(events).toEqual([{ event: 'token', data: '{"text":"a"}' }]);
  });

  it('ignores heartbeat comments and joins multi-line data', () => {
    const events = parseAll([': ping\n\n', 'event: x\ndata: a\ndata: b\n\n']);
    expect(events).toEqual([{ event: 'x', data: 'a\nb' }]);
  });

  it('does not emit an event before its blank line', () => {
    expect(parseAll(['event: token\ndata: {"text":"a"}\n'])).toEqual([]);
  });
});

describe('toChatEvent', () => {
  it('validates known events against the shared schema', () => {
    expect(toChatEvent({ event: 'token', data: '{"text":"Oi"}' })).toEqual({
      type: 'token',
      data: { text: 'Oi' },
    });
    expect(
      toChatEvent({
        event: 'done',
        data: '{"usage":{"inputTokens":1,"outputTokens":2},"latencyMs":5}',
      }),
    ).toEqual({ type: 'done', data: { usage: { inputTokens: 1, outputTokens: 2 }, latencyMs: 5 } });
  });

  it('ignores unknown event types', () => {
    expect(toChatEvent({ event: 'telepathy', data: '{"x":1}' })).toBeNull();
  });

  it('ignores malformed JSON and payloads that fail the schema', () => {
    expect(toChatEvent({ event: 'token', data: '{oops' })).toBeNull();
    expect(toChatEvent({ event: 'token', data: '{"text":42}' })).toBeNull();
  });

  it('parses message_reset (older clients drop it as an unknown event, like "telepathy")', () => {
    expect(toChatEvent({ event: 'message_reset', data: '{"reason":"truncated"}' })).toEqual({
      type: 'message_reset',
      data: { reason: 'truncated' },
    });
  });

  it('works end to end with the parser', () => {
    const [raw] = parseAll([
      'event: tool_start\ndata: {"id":"1","name":"search_dishes","label":"Buscando"}\n\n',
    ]);
    expect(toChatEvent(raw as RawSseEvent)).toEqual({
      type: 'tool_start',
      data: { id: '1', name: 'search_dishes', label: 'Buscando' },
    });
  });
});
