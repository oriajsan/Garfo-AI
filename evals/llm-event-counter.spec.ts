import { ConsoleLogger, Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

describe('LlmEventCountingLogger and the Nest testing module', () => {
  @Injectable()
  class Emitter {
    private readonly logger = new Logger('LlmTimeout');
    fire(): void {
      this.logger.warn(
        JSON.stringify({ event: 'llm_timeout', model: 'm', elapsedMs: 1, attempt: 1 }),
      );
    }
  }

  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Logger.overrideLogger(new ConsoleLogger());
  });

  // Root cause of "0 timeouts" in the real eval: compile() installs the silent TestingLogger.
  it('loses warnings when only Logger.overrideLogger is called before compile()', async () => {
    const logger = new LlmEventCountingLogger();
    Logger.overrideLogger(logger);
    const moduleRef = await Test.createTestingModule({ providers: [Emitter] }).compile();
    moduleRef.get(Emitter).fire();
    expect(logger.timeouts).toBe(0);
  });

  it('counts them when installed through setLogger', async () => {
    const logger = new LlmEventCountingLogger();
    const moduleRef = await Test.createTestingModule({ providers: [Emitter] })
      .setLogger(logger)
      .compile();
    moduleRef.get(Emitter).fire();
    expect(logger.timeouts).toBe(1);
  });
});
