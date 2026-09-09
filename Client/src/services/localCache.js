// services/localCache.js
//
// The database sits in Ohio; the hotel is in Kandy. Every query is a ~400ms
// round trip across the planet, and after a quiet spell the first one costs
// four seconds while the database wakes up. That is why opening the till felt
// slow — it was sitting on its hands waiting for a reply from another continent.
//
// The menu barely changes from one day to the next, so there is no reason to
// wait for it. Show the copy the till already has, immediately, and refresh it
// from the server in the background. The cashier sees the menu at once; if
// anything changed, it appears a moment later.
//
// This is only ever used for reference data. Anything that has to be right at
// this instant — a room's occupancy, stock, an order — is always read live.

const PREFIX = "pos_cache_";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What the till already knows, or null. */
export function readCache(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    if (!at || Date.now() - at > maxAgeMs) return null;
    return value ?? null;
  } catch { return null; }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // A full quota must never stop a sale. The till simply goes without.
  }
}

export function clearCache(key) {
  try { localStorage.removeItem(PREFIX + key); } catch {}
}

/**
 * Hand back what we have, then go and check.
 *
 * @param key        cache key, unique per branch
 * @param fetcher    () => Promise<value>
 * @param onFresh    called with newer data if the server had any
 * @returns          { value, fromCache }  — resolves immediately when cached
 *
 * A failed refresh is not an error when there is a cached copy: the till keeps
 * working with what it has, which is the whole point.
 */
export async function staleWhileRevalidate(key, fetcher, onFresh, maxAgeMs) {
  const cached = readCache(key, maxAgeMs);

  if (cached != null) {
    // Don't await — the caller renders now, this lands when it lands.
    Promise.resolve()
      .then(fetcher)
      .then((fresh) => {
        if (fresh == null) return;
        writeCache(key, fresh);
        if (JSON.stringify(fresh) !== JSON.stringify(cached)) onFresh?.(fresh);
      })
      .catch(() => {});
    return { value: cached, fromCache: true };
  }

  const fresh = await fetcher();
  writeCache(key, fresh);
  return { value: fresh, fromCache: false };
}
