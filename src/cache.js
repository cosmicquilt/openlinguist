// Small in-memory TTL cache, evicting the oldest entry once it's full.

const MAX_ENTRIES = 500
const cache = new Map()

// Caches the promise, not the result. Stremio often requests the same
// subtitle twice in a row, and the second request then waits on the first
// download instead of starting another. Failures are evicted so they can be retried.
export function cached(key, ttl, load) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = load()
  cache.set(key, { value, expires: Date.now() + ttl })
  value.catch(() => cache.delete(key))
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
  return value
}
