/**
 * In-memory data cache with TTL and in-flight request sharing.
 * Reuses fresh datasets when switching views or performing rapid branch
 * switches, deduplicates identical concurrent loads, and prevents a result
 * that was invalidated mid-flight from being stored back into the cache.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000; // 30 seconds

const cache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();
const generations = new Map<string, number>();

const bumpGeneration = (key: string): void => {
  generations.set(key, (generations.get(key) || 0) + 1);
};

export const dataCache = {
  get<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
    }
    return entry.data as T;
  },

  set<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  },

  /**
   * Return fresh cached data or share one in-flight load for the same key.
   * Invalidating a key while its request is running prevents the stale result
   * from being inserted back into the cache.
   */
  getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
    const cached = this.get(key) as T | null;
    if (cached !== null) return Promise.resolve(cached);

    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const generation = generations.get(key) || 0;
    const request = loader()
      .then((data) => {
        if ((generations.get(key) || 0) === generation) {
          this.set(key, data, ttlMs);
        }
        return data;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  },

  /** Remove a specific cache key (e.g. after a mutation) */
  invalidate(key: string): void {
    cache.delete(key);
    inFlight.delete(key);
    bumpGeneration(key);
  },

  /** Remove all cache entries whose key starts with the given prefix */
  invalidatePrefix(prefix: string): void {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        bumpGeneration(key);
      }
    }
    for (const key of inFlight.keys()) {
      if (key.startsWith(prefix)) {
        inFlight.delete(key);
        bumpGeneration(key);
      }
    }
  },

  /** Clear the entire cache (e.g. on logout or branch change) */
  clear(): void {
    for (const key of new Set([...cache.keys(), ...inFlight.keys()])) {
      bumpGeneration(key);
    }
    cache.clear();
    inFlight.clear();
  },
};

/**
 * Build a cache key from a prefix and optional location id.
 * Example: cacheKey('patients', 'loc-abc') -> 'patients:loc-abc'
 */
export const cacheKey = (prefix: string, locationId?: string): string =>
  locationId ? `${prefix}:${locationId}` : prefix;
