import { discountWait, parseEvalDelayMs, RateGate, type RateGateClock } from './rate-gate';

function fakeClock(): RateGateClock & { time: number; sleeps: number[] } {
  const clock = {
    time: 1000,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: (ms: number) => {
      clock.sleeps.push(ms);
      clock.time += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

describe('RateGate', () => {
  it('does not wait on the first call', async () => {
    const clock = fakeClock();
    await new RateGate(2000, clock).wait();
    expect(clock.sleeps).toEqual([]);
  });

  it('waits the remainder when the second call is inside the window', async () => {
    const clock = fakeClock();
    const gate = new RateGate(2000, clock);
    await gate.wait();
    clock.time += 500;
    await gate.wait();
    expect(clock.sleeps).toEqual([1500]);
  });

  it('does not wait when enough time has passed', async () => {
    const clock = fakeClock();
    const gate = new RateGate(2000, clock);
    await gate.wait();
    clock.time += 2500;
    await gate.wait();
    expect(clock.sleeps).toEqual([]);
  });

  it('spaces concurrent callers', async () => {
    const clock = fakeClock();
    const gate = new RateGate(1000, clock);
    await Promise.all([gate.wait(), gate.wait(), gate.wait()]);
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it('never sleeps with a zero delay', async () => {
    const clock = fakeClock();
    const gate = new RateGate(0, clock);
    await gate.wait();
    await gate.wait();
    expect(clock.sleeps).toEqual([]);
  });
});

describe('wait accounting', () => {
  it('accumulates only the time actually slept, across several waits in one reply', async () => {
    const clock = fakeClock();
    const gate = new RateGate(2000, clock);
    await gate.wait();
    const before = gate.waitedMs;
    clock.time += 500; // some real work
    await gate.wait(); // sleeps 1500
    await gate.wait(); // sleeps 2000
    clock.time += 300;
    await gate.wait(); // sleeps 1700
    expect(gate.waitedMs - before).toBe(5200);
    expect(gate.waitedMs).toBe(5200);
  });

  it('counts calls per kind', async () => {
    const gate = new RateGate(0, fakeClock());
    await gate.wait('chat');
    await gate.wait('chat');
    await gate.wait('embed');
    expect(gate.calls).toEqual({ chat: 2, embed: 1 });
  });
});

describe('discountWait', () => {
  it('subtracts the waited time from the latency', () => {
    expect(discountWait(9000, 5200)).toBe(3800);
    expect(discountWait(900, 0)).toBe(900);
  });

  it('never goes below zero', () => {
    expect(discountWait(100, 500)).toBe(0);
  });
});

describe('parseEvalDelayMs', () => {
  it('defaults to 2000 with the real provider', () => {
    expect(parseEvalDelayMs(undefined, 'openai')).toBe(2000);
    expect(parseEvalDelayMs('', 'openai')).toBe(2000);
  });

  it('accepts a valid integer, including 0', () => {
    expect(parseEvalDelayMs('5000', 'openai')).toBe(5000);
    expect(parseEvalDelayMs('0', 'openai')).toBe(0);
  });

  it.each(['-1', '1.5', 'abc', '2s'])('rejects %s with a clear error', (raw) => {
    expect(() => parseEvalDelayMs(raw, 'openai')).toThrow(/EVAL_DELAY_MS inválido/);
  });

  it('is always 0 with the fake provider', () => {
    expect(parseEvalDelayMs(undefined, 'fake')).toBe(0);
    expect(parseEvalDelayMs('5000', 'fake')).toBe(0);
    expect(() => parseEvalDelayMs('abc', 'fake')).toThrow(/EVAL_DELAY_MS inválido/);
  });
});
