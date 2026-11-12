import { truncationReason } from './truncation';

const base = {
  finishReason: 'stop',
  toolCallCount: 0,
  rawText: 'Tudo certo.',
  unclosedMarkerAtEnd: false,
};

describe('truncationReason', () => {
  it('accepts a finished, well-formed answer', () => {
    expect(truncationReason(base)).toBeNull();
    expect(truncationReason({ ...base, rawText: 'O **Homus** é do *Oriente*' })).toBeNull();
    expect(truncationReason({ ...base, rawText: 'Sem pontuação final' })).toBeNull();
    expect(truncationReason({ ...base, rawText: 'Opção (vegana)' })).toBeNull();
  });

  it('flags a missing or invalid finish_reason', () => {
    expect(truncationReason({ ...base, finishReason: null })).toBe('no_finish_reason');
    expect(truncationReason({ ...base, finishReason: 'length' })).toBe('finish_reason_length');
    expect(truncationReason({ ...base, finishReason: 'content_filter' })).toBe(
      'finish_reason_content_filter',
    );
  });

  it('flags structurally incomplete text', () => {
    expect(truncationReason({ ...base, rawText: 'O **Homus é', unclosedMarkerAtEnd: false })).toBe(
      'odd_bold_markers',
    );
    expect(truncationReason({ ...base, rawText: 'é do restaurante *' })).toBe(
      'ends_with_open_emphasis',
    );
    expect(truncationReason({ ...base, rawText: 'é do restaurante **' })).toBe('odd_bold_markers');
    expect(truncationReason({ ...base, rawText: 'veja [' })).toBe('ends_with_open_bracket');
    expect(truncationReason({ ...base, rawText: 'veja (' })).toBe('ends_with_open_bracket');
    expect(truncationReason({ ...base, unclosedMarkerAtEnd: true })).toBe('unclosed_dish_marker');
  });

  it('does not run the text heuristics when there are tool calls', () => {
    expect(
      truncationReason({
        ...base,
        finishReason: 'tool_calls',
        toolCallCount: 1,
        rawText: 'vou **',
      }),
    ).toBeNull();
    expect(
      truncationReason({ ...base, finishReason: 'length', toolCallCount: 1, rawText: '' }),
    ).toBe('finish_reason_length');
  });
});
