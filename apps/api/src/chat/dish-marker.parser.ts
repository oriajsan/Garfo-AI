const OPEN = '[[dish:';
const CLOSE = ']]';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VALID_MARKER = new RegExp(`^\\[\\[dish:(${UUID})\\]\\]$`, 'i');
/** Longest a real marker can be; past this without a closing `]]` it was never a marker. */
const MAX_MARKER_LENGTH = OPEN.length + 36 + CLOSE.length + 8;
const PUNCTUATION_AFTER_SPACE = /^[.,;:!?)\]\n]/;

/**
 * Streaming filter for `[[dish:<uuid>]]` markers (SPEC section 6).
 *
 * `push` receives the model's deltas and returns the text that is safe to show: markers are
 * removed, and anything that could still become a marker (a trailing `[`, `[[di`...) stays in
 * the buffer until the next delta disambiguates it. The text returned NEVER contains `[[dish:`:
 * a malformed marker (bad uuid, never closed) is dropped as well, and counted in `malformed`.
 * Spaces next to a removed marker are collapsed ("X [[id]]." becomes "X.").
 */
export class DishMarkerParser {
  private buffer = '';
  /** Whitespace held back until we know what follows (it may sit next to a marker). */
  private heldSpaces = '';
  private afterMarker = false;
  private emittedAny = false;
  private lastEmitted = '';
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private malformedCount = 0;

  /** Ids found so far, in order of appearance, without repeats (lower-cased). */
  get ids(): string[] {
    return [...this.order];
  }

  get malformed(): number {
    return this.malformedCount;
  }

  push(delta: string): string {
    this.buffer += delta;
    return this.drain(false);
  }

  /** Call once at the end of the stream: releases whatever was held back. */
  flush(): string {
    const text = this.drain(true);
    const tail = this.afterMarker ? '' : this.heldSpaces;
    this.heldSpaces = '';
    return text + this.track(tail);
  }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      const start = this.buffer.indexOf(OPEN);
      if (start === -1) {
        const hold = final ? 0 : partialOpenLength(this.buffer);
        out += this.text(this.buffer.slice(0, this.buffer.length - hold));
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        return out;
      }

      out += this.text(this.buffer.slice(0, start));
      this.buffer = this.buffer.slice(start);

      const close = this.buffer.indexOf(CLOSE);
      if (close === -1 || close + CLOSE.length > MAX_MARKER_LENGTH) {
        if (!final && this.buffer.length <= MAX_MARKER_LENGTH && close === -1) return out; // wait
        // Never closed (or absurdly long): not a marker. Drop only the opener, keep the rest.
        this.malformedCount += 1;
        this.buffer = this.buffer.slice(OPEN.length);
        this.afterMarker = true;
        continue;
      }

      const candidate = this.buffer.slice(0, close + CLOSE.length);
      const match = VALID_MARKER.exec(candidate);
      if (match?.[1]) {
        const id = match[1].toLowerCase();
        if (!this.seen.has(id)) {
          this.seen.add(id);
          this.order.push(id);
        }
      } else {
        this.malformedCount += 1;
      }
      this.buffer = this.buffer.slice(close + CLOSE.length);
      this.afterMarker = true;
    }
  }

  /** Emits plain text, holding trailing spaces and collapsing the ones around markers. */
  private text(raw: string): string {
    let text = raw;
    if (text === '') return '';
    if (this.afterMarker) {
      if (this.heldSpaces !== '' || !this.emittedAny || this.lastEmitted === '\n') {
        text = text.replace(/^ +/, '');
        if (text === '') return '';
      }
      if (this.heldSpaces !== '' && PUNCTUATION_AFTER_SPACE.test(text)) this.heldSpaces = '';
      this.afterMarker = false;
    }
    const full = this.heldSpaces + text;
    const trailing = /[ ]+$/.exec(full)?.[0] ?? '';
    this.heldSpaces = trailing;
    return this.track(full.slice(0, full.length - trailing.length));
  }

  private track(text: string): string {
    if (text !== '') {
      this.emittedAny = true;
      this.lastEmitted = text.slice(-1);
    }
    return text;
  }
}

/** Length of the longest suffix of `text` that is a proper prefix of `[[dish:`. */
function partialOpenLength(text: string): number {
  const max = Math.min(text.length, OPEN.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (OPEN.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}
