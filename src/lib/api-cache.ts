export const TTL_15MIN = 15 * 60 * 1000;
export const TTL_4H = 4 * 60 * 60 * 1000;

const store = new Map<string, { data: unknown; cachedAt: number; ttl: number }>();

export function getCached(key: string): { data: unknown; cachedAt: number } | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.cachedAt + entry.ttl) {
    store.delete(key);
    return null;
  }
  return entry;
}

export function setCached(key: string, data: unknown, ttl = TTL_15MIN): void {
  store.set(key, { data, cachedAt: Date.now(), ttl });
}

export function cachedJson(data: unknown, hit: boolean, cachedAt?: number): Response {
  const ageSeconds = cachedAt ? Math.round((Date.now() - cachedAt) / 1000) : 0;
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'X-Cache': hit ? 'HIT' : 'MISS',
      'X-Cache-Age': String(ageSeconds),
    },
  });
}
