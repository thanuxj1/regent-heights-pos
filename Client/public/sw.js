/* Regent Heights POS — offline shell.
 *
 * Without this, opening the till downloads the whole app from the server every
 * time. No connection meant a blank page: a cashier who reloaded during an
 * outage was locked out until it came back, even though their queued sales were
 * safe on the machine.
 *
 * The obvious worry with keeping a copy on the till is staleness — you deploy a
 * fix and the front desk keeps running last week's build. That is avoided here
 * by treating two kinds of file completely differently:
 *
 *   /assets/index-DzeQznXY.js   Vite names every build artefact after its own
 *                               contents. That exact name will never hold
 *                               different code, so it is safe to keep forever.
 *                               A new deploy simply asks for new names.
 *
 *   index.html                  The one file that says which names are current.
 *                               Always fetched from the network first, so a
 *                               deploy is picked up on the next load. The cached
 *                               copy is only used when the network cannot answer.
 *
 * So the till is instant and works offline, and still cannot get stuck on an
 * old version while it has a connection.
 */

// v2: the data cache was keyed on URLs carrying a "_ts" timestamp, so it was
// never hit; bumping the version clears those useless copies.
const VERSION = "v2";
const SHELL = `rh-pos-shell-${VERSION}`;
const ASSETS = `rh-pos-assets-${VERSION}`;
const DATA = `rh-pos-data-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA];

// Read-only reference data the till can still show while offline. Anything that
// moves money or depends on a live answer is deliberately absent — a stale room
// list or stock level is worse than none.
const CACHEABLE_DATA = [/\/api\/branch_products/, /\/api\/categories/, /\/api\/branches\//];

self.addEventListener("install", (event) => {
  // Take over as soon as this build is ready rather than waiting for every tab
  // to close — a till is often left open for days.
  event.waitUntil(
    caches.open(SHELL).then((c) => c.add("/")).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed build output: safe to serve from the cache without asking. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/**
 * The cache key for a data request: its URL without the "_ts" cache-buster the
 * app adds to every call. Keyed on the full URL, no two requests ever matched,
 * so the "last good copy" below could never be found.
 */
function cacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete("_ts");
  return url.toString();
}

/**
 * Prefer fresh; fall back to the last good copy when the network is slow or out.
 * A slow answer with no copy to fall back on is still waited for: giving up
 * after a few seconds used to empty the till ("503", no products) whenever the
 * connection was merely slow.
 */
async function networkFirst(request, cacheName, timeoutMs = 4000, key = request) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (response) => {
    if (response.ok) cache.put(key, response.clone());
    // A server error (5xx) is no better than no answer: the server or the
    // proxy in front of it is down. Serve the saved copy if there is one —
    // only a network failure used to count, so a 502 from a gateway emptied
    // the business name off the receipt.
    if (response.status >= 500) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    return response;
  });
  network.catch(() => {}); // a late failure after a saved copy was served is not an error
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), timeoutMs)),
    ]);
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return network; // nothing saved: keep waiting; rejects only if truly offline
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;             // sales go through the queue, never here

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.pathname.startsWith("/socket.io/")) return; // live updates need a live socket

  // The page itself: fresh when possible, cached copy when the network is out.
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL).catch(() =>
        caches.match("/", { cacheName: SHELL }).then((hit) => hit || Response.error()),
      ),
    );
    return;
  }

  // Build output — the name encodes the contents, so this is never stale.
  if (url.origin === self.location.origin && /^\/assets\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS).catch(() => Response.error()));
    return;
  }

  if (CACHEABLE_DATA.some((re) => re.test(url.pathname))) {
    event.respondWith(
      networkFirst(request, DATA, 4000, cacheKey(request)).catch(
        () => new Response(JSON.stringify({ offline: true, data: [] }), {
          status: 503, headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    return;
  }

  // Everything else: normal network, no caching. A wrong answer from a cache is
  // worse than an error the till already knows how to handle.
});
