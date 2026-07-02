/**
 * In-process TTL cache (Redis-compatible key scheme).
 * Postgres-only deployment — swap backing store to Redis without changing callers.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export const CACHE_TTL_MS = 5 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number = CACHE_TTL_MS
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheDeletePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheKeySession(sessionId: string): string {
  return `session:${sessionId}`;
}

export function cacheKeySessionList(hash: string): string {
  return `session:list:${hash}`;
}
