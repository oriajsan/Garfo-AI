import { LlmEventCountingLogger } from './llm-event-counter';

describe('LlmEventCountingLogger', () => {
  let logger: LlmEventCountingLogger;
  beforeEach(() => {
    logger = new LlmEventCountingLogger();
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts llm_retry warnings and sums their backoff', () => {
    const line = (waitMs: number) =>
      JSON.stringify({ event: 'llm_retry', status: 503, attempt: 1, waitMs });
    logger.warn(line(1000), 'LlmRetry');
    logger.warn(line(3000), 'LlmRetry');
    expect(logger.count).toBe(2);
    expect(logger.waitMs).toBe(4000);
  });

  it('counts llm_timeout and llm_fallback events', () => {
    logger.warn(JSON.stringify({ event: 'llm_timeout', model: 'a', elapsedMs: 15000, attempt: 1 }));
    logger.warn(JSON.stringify({ event: 'llm_timeout', model: 'b', elapsedMs: 15000, attempt: 2 }));
    logger.warn(JSON.stringify({ event: 'llm_fallback', from: 'a', to: 'b', result: 'timeout' }));
    expect(logger.timeouts).toBe(2);
    expect(logger.fallbacks).toBe(1);
    expect(logger.count).toBe(0);
  });

  it('ignores other warnings and malformed lines', () => {
    logger.warn('something else');
    logger.warn('{"event":"other"}');
    logger.warn('"llm_retry" but not json');
    expect(logger.count).toBe(0);
  });
});
