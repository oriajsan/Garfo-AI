import { startOfDaySaoPaulo } from './time';

describe('startOfDaySaoPaulo', () => {
  it('uses the São Paulo date, not the UTC one', () => {
    // 01:30 UTC on the 13th is still 22:30 on the 12th in São Paulo.
    expect(startOfDaySaoPaulo(new Date('2026-11-13T01:30:00Z')).toISOString()).toBe(
      '2026-11-12T03:00:00.000Z',
    );
  });

  it('rolls over at 03:00 UTC', () => {
    expect(startOfDaySaoPaulo(new Date('2026-11-13T03:00:00Z')).toISOString()).toBe(
      '2026-11-13T03:00:00.000Z',
    );
  });
});
