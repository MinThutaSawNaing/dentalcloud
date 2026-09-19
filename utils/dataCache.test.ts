import { describe, expect, it, beforeEach } from 'vitest';
import { dataCache, cacheKey } from './dataCache';

describe('dataCache', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  it('stores and retrieves data', () => {
    dataCache.set('test-key', { name: 'John' });
    expect(dataCache.get('test-key')).toEqual({ name: 'John' });
  });

  it('returns null for missing key', () => {
    expect(dataCache.get('nonexistent')).toBeNull();
  });

  it('expires entries after TTL', async () => {
    dataCache.set('expiring-key', 'hello', 10); // 10ms TTL
    expect(dataCache.get('expiring-key')).toBe('hello');
    await new Promise((r) => setTimeout(r, 15));
    expect(dataCache.get('expiring-key')).toBeNull();
  });

  it('invalidates a specific key', () => {
    dataCache.set('key-a', 1);
    dataCache.set('key-b', 2);
    dataCache.invalidate('key-a');
    expect(dataCache.get('key-a')).toBeNull();
    expect(dataCache.get('key-b')).toBe(2);
  });

  it('invalidates by prefix', () => {
    dataCache.set('patients:loc-1', [1, 2]);
    dataCache.set('patients:loc-2', [3, 4]);
    dataCache.set('appointments:loc-1', [5]);
    dataCache.invalidatePrefix('patients:');
    expect(dataCache.get('patients:loc-1')).toBeNull();
    expect(dataCache.get('patients:loc-2')).toBeNull();
    expect(dataCache.get('appointments:loc-1')).toEqual([5]);
  });

  it('clears all entries', () => {
    dataCache.set('a', 1);
    dataCache.set('b', 2);
    dataCache.clear();
    expect(dataCache.get('a')).toBeNull();
    expect(dataCache.get('b')).toBeNull();
  });
});

describe('dataCache.getOrLoad', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  it('deduplicates identical in-flight loads', async () => {
    let calls = 0;
    let resolveLoad!: (value: string) => void;
    const loader = () => {
      calls += 1;
      return new Promise<string>((resolve) => { resolveLoad = resolve; });
    };

    const first = dataCache.getOrLoad('shared', loader);
    const second = dataCache.getOrLoad('shared', loader);
    expect(calls).toBe(1);
    resolveLoad('loaded');
    await expect(Promise.all([first, second])).resolves.toEqual(['loaded', 'loaded']);
    expect(dataCache.get('shared')).toBe('loaded');
  });

  it('serves a fresh entry without calling the loader again', async () => {
    dataCache.set('warm', 'cached', 5_000);
    let calls = 0;
    await expect(dataCache.getOrLoad('warm', async () => { calls += 1; return 'network'; })).resolves.toBe('cached');
    expect(calls).toBe(0);
  });

  it('does not cache rejected loads', async () => {
    await expect(dataCache.getOrLoad('failed', async () => {
      throw new Error('network');
    })).rejects.toThrow('network');
    expect(dataCache.get('failed')).toBeNull();
  });

  it('does not repopulate a key invalidated while loading', async () => {
    let resolveLoad!: (value: string) => void;
    const request = dataCache.getOrLoad('stale', () => new Promise<string>((resolve) => {
      resolveLoad = resolve;
    }));
    dataCache.invalidate('stale');
    resolveLoad('old branch data');
    await expect(request).resolves.toBe('old branch data');
    expect(dataCache.get('stale')).toBeNull();
  });

  it('allows a forced reload after invalidating an in-flight key', async () => {
    let resolveOld!: (value: string) => void;
    const oldRequest = dataCache.getOrLoad('refreshing', () => new Promise<string>((resolve) => {
      resolveOld = resolve;
    }));
    dataCache.invalidate('refreshing');
    const freshRequest = dataCache.getOrLoad('refreshing', async () => 'fresh');
    await expect(freshRequest).resolves.toBe('fresh');
    resolveOld('old');
    await expect(oldRequest).resolves.toBe('old');
    expect(dataCache.get('refreshing')).toBe('fresh');
  });
});

describe('cacheKey', () => {
  it('builds key with location id', () => {
    expect(cacheKey('patients', 'loc-123')).toBe('patients:loc-123');
  });

  it('builds key without location id', () => {
    expect(cacheKey('locations')).toBe('locations');
  });
});
