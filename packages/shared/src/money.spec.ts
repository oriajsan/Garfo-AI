import { centsToReais, formatBRL, reaisToCents } from './money';

describe('reaisToCents', () => {
  it.each([
    [0, 0],
    [32.9, 3290],
    [8, 800],
    [1.005, 101],
    [19.999, 2000],
    [0.1 + 0.2, 30],
  ])('converts %p reais to %p cents', (reais, cents) => {
    expect(reaisToCents(reais)).toBe(cents);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (value) => {
    expect(() => reaisToCents(value)).toThrow(RangeError);
  });
});

describe('centsToReais', () => {
  it('converts cents to reais', () => {
    expect(centsToReais(0)).toBe(0);
    expect(centsToReais(3290)).toBe(32.9);
  });

  it('rejects negative and fractional cents', () => {
    expect(() => centsToReais(-1)).toThrow(RangeError);
    expect(() => centsToReais(10.5)).toThrow(RangeError);
  });
});

describe('formatBRL', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [3290, 'R$ 32,90'],
    [100000, 'R$ 1.000,00'],
    [123456789, 'R$ 1.234.567,89'],
  ])('formats %p as %p', (cents, expected) => {
    expect(formatBRL(cents)).toBe(expected);
  });

  it('uses a plain space and rejects negatives', () => {
    expect(formatBRL(3290)).not.toContain(' ');
    expect(() => formatBRL(-100)).toThrow(RangeError);
  });
});
