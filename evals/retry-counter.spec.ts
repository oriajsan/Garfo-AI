import { RetryCountingLogger } from './retry-counter';

describe('RetryCountingLogger', () => {
  let logger: RetryCountingLogger;
  beforeEach(() => {
    logger = new RetryCountingLogger();
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

  it('ignores other warnings and malformed lines', () => {
    logger.warn('something else');
    logger.warn('{"event":"other"}');
    logger.warn('"llm_retry" but not json');
    expect(logger.count).toBe(0);
  });
});
