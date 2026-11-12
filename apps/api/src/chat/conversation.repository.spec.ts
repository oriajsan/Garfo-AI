import { toHistory, type StoredMessage } from './conversation.repository';

let n = 0;
const row = (role: StoredMessage['role'], content: unknown): StoredMessage => ({
  id: `m${(n += 1)}`,
  role,
  content,
  createdAt: new Date(n),
});
const user = (text: string) => row('USER', { text });
const assistant = (
  text: string,
  toolCalls?: Array<{ id: string; name: string; argsJson: string; extraContent?: unknown }>,
) => row('ASSISTANT', { text, ...(toolCalls ? { toolCalls } : {}) });
const tool = (toolCallId: string, name = 'search_dishes') =>
  row('TOOL', { toolCallId, name, result: { ok: true } });
const call = (id: string) => ({ id, name: 'search_dishes', argsJson: '{}' });

describe('toHistory', () => {
  it('maps a full round with the tool message right after its assistant message', () => {
    const history = toHistory([
      user('oi'),
      assistant('', [call('c1'), call('c2')]),
      tool('c1'),
      tool('c2'),
      assistant('pronto'),
    ]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    expect(history[2]).toMatchObject({ role: 'tool', toolCallId: 'c1', content: '{"ok":true}' });
  });

  it('drops everything before the first USER message (no orphan TOOL)', () => {
    const history = toHistory([
      tool('c0'),
      assistant('sobra do corte'),
      user('segunda pergunta'),
      assistant('resposta'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'segunda pergunta' },
      { role: 'assistant', content: 'resposta' },
    ]);
  });

  it('returns nothing when there is no USER message', () => {
    expect(toHistory([assistant('x'), tool('c')])).toEqual([]);
  });

  it('drops a tool-call group whose results are incomplete', () => {
    const history = toHistory([
      user('oi'),
      assistant('', [call('c1'), call('c2')]),
      tool('c1'),
      user('de novo'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'user', content: 'de novo' },
    ]);
  });

  it('skips rows with unreadable content', () => {
    expect(toHistory([user('ok'), row('ASSISTANT', { nope: true }), row('USER', 42)])).toEqual([
      { role: 'user', content: 'ok' },
    ]);
  });
});

describe('toHistory with thought signatures', () => {
  const extraContent = { google: { thought_signature: 'sig-abc==' } };

  it('rehydrates extraContent from the stored row untouched', () => {
    const history = toHistory([
      user('oi'),
      assistant('', [{ ...call('c1'), extraContent }, call('c2')]),
      tool('c1'),
      tool('c2'),
    ]);
    const assistantMsg = history[1];
    expect(assistantMsg).toMatchObject({ role: 'assistant' });
    if (assistantMsg?.role !== 'assistant') throw new Error('unexpected role');
    expect(assistantMsg.toolCalls?.[0]).toEqual({ ...call('c1'), extraContent });
    expect(assistantMsg.toolCalls?.[1]).toEqual(call('c2'));
  });

  it('round-trips through JSON serialisation (Message.content)', () => {
    const stored = JSON.parse(
      JSON.stringify({ text: '', toolCalls: [{ ...call('c1'), extraContent }] }),
    ) as unknown;
    const history = toHistory([user('oi'), row('ASSISTANT', stored), tool('c1')]);
    expect(history[1]).toMatchObject({ toolCalls: [{ extraContent }] });
  });

  it('still loads old rows without the field', () => {
    const history = toHistory([user('oi'), assistant('', [call('c1')]), tool('c1')]);
    expect(history).toHaveLength(3);
  });
});
