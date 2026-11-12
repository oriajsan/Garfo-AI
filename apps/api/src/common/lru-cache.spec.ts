import { LruCache } from './lru-cache';

describe('LruCache', () => {
  it('stores and returns values', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a becomes most recent
    cache.set('c', 3); // evicts b
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('overwriting a key refreshes it without growing', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3); // evicts b
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
  });

  it('rejects invalid capacities', () => {
    expect(() => new LruCache(0)).toThrow(RangeError);
  });
});
