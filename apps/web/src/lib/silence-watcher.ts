/** Silence (no new stream event) after which the UI says the assistant is slower than usual. */
export const SLOW_AFTER_MS = 8000;

export interface SilenceWatcher {
  /** Call on every event: hides the notice and restarts the countdown. */
  touch: () => void;
  /** Call when the stream ends for any reason: hides the notice and stops the timer. */
  stop: () => void;
}

/**
 * Counts SILENCE, not total time: `onChange(true)` fires after `thresholdMs` without `touch()`,
 * and `onChange(false)` as soon as an event arrives or the watcher stops. Starts counting
 * immediately. Pure timers, so it is testable with fake timers.
 */
export function createSilenceWatcher(
  onChange: (slow: boolean) => void,
  thresholdMs: number = SLOW_AFTER_MS,
): SilenceWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let slow = false;
  let stopped = false;

  const setSlow = (value: boolean): void => {
    if (slow === value) return;
    slow = value;
    onChange(value);
  };
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => setSlow(true), thresholdMs);
  };
  arm();

  return {
    touch() {
      if (stopped) return;
      setSlow(false);
      arm();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      setSlow(false);
    },
  };
}
