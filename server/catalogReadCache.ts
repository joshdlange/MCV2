/** Tiny per-instance cache for public catalog metadata, never user-owned data. */
export function createCatalogReadCache(ttlMs = 15_000, now = Date.now) {
  let generation = 0;
  const entries = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  return {
    invalidate() {
      generation++;
      entries.clear();
      pending.clear();
    },
    async get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value as T;
      const underway = pending.get(key);
      if (underway) return underway as Promise<T>;
      const version = generation;
      const request = Promise.resolve().then(load).then(value => {
        if (generation === version) entries.set(key, { value, expires: now() + ttlMs });
        return value;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}

export const catalogReadCache = createCatalogReadCache();
