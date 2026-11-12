import {
  applySeed,
  DEFAULT_SEED_TX_MAX_WAIT_MS,
  DEFAULT_SEED_TX_TIMEOUT_MS,
  resolveSeedTxOptions,
} from '../../prisma/seed-apply';
import { type SeedFile } from '../../prisma/seed-data';

describe('resolveSeedTxOptions', () => {
  it('uses the defaults (120 s / 20 s) when unset or blank', () => {
    expect(resolveSeedTxOptions({})).toEqual({ timeout: 120_000, maxWait: 20_000 });
    expect(resolveSeedTxOptions({ SEED_TX_TIMEOUT_MS: ' ' })).toEqual({
      timeout: DEFAULT_SEED_TX_TIMEOUT_MS,
      maxWait: DEFAULT_SEED_TX_MAX_WAIT_MS,
    });
  });

  it('reads the values from the environment', () => {
    expect(
      resolveSeedTxOptions({ SEED_TX_TIMEOUT_MS: '300000', SEED_TX_MAX_WAIT_MS: '5000' }),
    ).toEqual({
      timeout: 300_000,
      maxWait: 5_000,
    });
  });

  it.each(['0', '-5', '1.5', 'abc', '10s', '1e3'])('rejects %p', (value) => {
    expect(() => resolveSeedTxOptions({ SEED_TX_TIMEOUT_MS: value })).toThrow(/SEED_TX_TIMEOUT_MS/);
    expect(() => resolveSeedTxOptions({ SEED_TX_MAX_WAIT_MS: value })).toThrow(
      /SEED_TX_MAX_WAIT_MS/,
    );
  });
});

describe('applySeed', () => {
  it('passes the timeout and maxWait options to $transaction', async () => {
    const $transaction = jest.fn().mockResolvedValue(undefined);
    const data = { restaurants: [] } as unknown as SeedFile;

    await applySeed({ $transaction } as never, data, resolveSeedTxOptions({}));
    expect($transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      timeout: 120_000,
      maxWait: 20_000,
    });

    await applySeed(
      { $transaction } as never,
      data,
      resolveSeedTxOptions({ SEED_TX_TIMEOUT_MS: '1', SEED_TX_MAX_WAIT_MS: '2' }),
    );
    expect($transaction).toHaveBeenLastCalledWith(expect.any(Function), { timeout: 1, maxWait: 2 });
  });
});
