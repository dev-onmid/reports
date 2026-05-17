const TTL_MS = 15 * 60 * 1000; // 15 minutes

const store = new Map<string, { data: unknown; cachedAt: number }>();

export function getCached(key: string): { data: unknown; cachedAt: number } | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.cachedAt + TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry;
}

export function setCached(key: string, data: unknown): void {
  store.set(key, { data, cachedAt: Date.now() });
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
