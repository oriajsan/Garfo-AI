/** Finish reasons that mean the model really finished its turn. */
const COMPLETE_FINISH_REASONS: ReadonlySet<string> = new Set(['stop', 'tool_calls']);

export function isCompleteFinish(finishReason: string | null): boolean {
  return finishReason !== null && COMPLETE_FINISH_REASONS.has(finishReason);
}

export interface TruncationInput {
  finishReason: string | null;
  toolCallCount: number;
  /** Raw model text (markers included). */
  rawText: string;
  /** True when flushing the marker parser found a `[[dish:` that never closed. */
  unclosedMarkerAtEnd: boolean;
}

/**
 * Why a model turn looks cut short, or null when it looks complete (D6.18).
 * The text heuristics are deliberately conservative and only run without tool calls; they never
 * look at punctuation. A run of `*` closing an italic/bold word (`*abc*`) is fine; only one that
 * opens something (start of text or after whitespace) counts.
 */
export function truncationReason(input: TruncationInput): string | null {
  if (input.finishReason === null) return 'no_finish_reason';
  if (!isCompleteFinish(input.finishReason)) return `finish_reason_${input.finishReason}`;
  if (input.toolCallCount > 0) return null;

  const text = input.rawText.trimEnd();
  if (input.unclosedMarkerAtEnd) return 'unclosed_dish_marker';
  if ((text.match(/\*\*/g) ?? []).length % 2 === 1) return 'odd_bold_markers';
  if (/(^|\s)\*+$/.test(text)) return 'ends_with_open_emphasis';
  if (/[[(]$/.test(text)) return 'ends_with_open_bracket';
  return null;
}
