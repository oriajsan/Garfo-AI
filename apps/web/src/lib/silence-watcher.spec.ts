import { createSilenceWatcher, SLOW_AFTER_MS } from './silence-watcher';

describe('createSilenceWatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('flags slow after 8 s of silence and clears on the next event', () => {
    const onChange = jest.fn();
    const watcher = createSilenceWatcher(onChange);
    jest.advanceTimersByTime(SLOW_AFTER_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    watcher.touch();
    expect(onChange).toHaveBeenLastCalledWith(false);
    watcher.stop();
  });

  it('counts silence, not total time: steady events never trigger it', () => {
    const onChange = jest.fn();
    const watcher = createSilenceWatcher(onChange);
    for (let i = 0; i < 10; i += 1) {
      jest.advanceTimersByTime(SLOW_AFTER_MS - 1000);
      watcher.touch();
    }
    expect(onChange).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('restarts the countdown after an event', () => {
    const onChange = jest.fn();
    const watcher = createSilenceWatcher(onChange);
    jest.advanceTimersByTime(5000);
    watcher.touch();
    jest.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3000);
    expect(onChange).toHaveBeenLastCalledWith(true);
    watcher.stop();
  });

  it('hides the notice and stays quiet once stopped', () => {
    const onChange = jest.fn();
    const watcher = createSilenceWatcher(onChange);
    jest.advanceTimersByTime(SLOW_AFTER_MS);
    watcher.stop();
    expect(onChange).toHaveBeenLastCalledWith(false);
    watcher.touch();
    jest.advanceTimersByTime(SLOW_AFTER_MS * 3);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
