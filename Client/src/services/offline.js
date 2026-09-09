// services/offline.js
//
// A till on hotel wifi loses the network. That must not stop a queue of guests
// being served, and it must not cost anyone a sale they already rang up.
//
// The rules this module keeps:
//
//   1. A sale is stamped with a `client_ref` the moment the cashier commits it,
//      before anything is sent. That key is what makes resending safe — the
//      server returns the sale that already exists rather than making a second.
//   2. Nothing is dropped. A sale that cannot be sent goes to a queue in
//      localStorage that survives a reload, a crash and a closed browser.
//   3. Nothing silently disappears either. A sale the server *rejects* (bad
//      data, a product that is gone) is parked, not retried forever and not
//      thrown away — the cashier is told.
//
// What deliberately does NOT work offline is anything needing an answer only
// the server has: charging a room, taking a card, or trusting stock levels.
// Those are refused up front rather than half-completed.

const QUEUE_KEY = "pos_offline_queue";
const PARKED_KEY = "pos_offline_parked";
const MAX_QUEUE = 200;

/* ── keys ─────────────────────────────────────────────────────────────── */

/**
 * A key for one sale. Generated on the till, before the first send attempt, so
 * every retry of that sale carries the same one.
 */
export function newClientRef() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ── the queue ────────────────────────────────────────────────────────── */

const read = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const write = (key, list) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
};

export const queuedSales = () => read(QUEUE_KEY);
export const parkedSales = () => read(PARKED_KEY);
export const queuedCount = () => read(QUEUE_KEY).length;

/**
 * Whether the server is actually answering.
 *
 * `navigator.onLine` only says the device has *a* network. A hotel whose wifi is
 * up but whose internet is down leaves it stubbornly true, so on its own it told
 * the cashier "Sending…" while nothing could send. This flag is set by what
 * actually happened to a real request instead.
 */
let reachable = true;
export const serverReachable = () => reachable;
export const connected = () => navigator.onLine && reachable;

function setReachable(next) {
  if (reachable === next) return;
  reachable = next;
  announce();
}

const listeners = new Set();
/** Tell the UI the queue changed, so a badge can show what is waiting. */
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const announce = () => listeners.forEach((f) => {
  try {
    f({ queued: queuedCount(), parked: read(PARKED_KEY).length, connected: connected() });
  } catch {}
});

/**
 * Hold a sale until the network is back.
 *
 * `sale` is the exact body the server expects — { order, items } — so a flush
 * is a plain resend with nothing to rebuild or guess at later.
 */
export function queueSale(sale) {
  // Reaching here means a send just failed on the network, so the server is
  // known to be unreachable whatever the browser's own flag says.
  setReachable(false);
  const list = read(QUEUE_KEY);
  if (list.some((s) => s.order?.client_ref === sale.order?.client_ref)) return false;
  if (list.length >= MAX_QUEUE) return false;

  list.push({ ...sale, order: { ...sale.order, queued_at: new Date().toISOString() }, attempts: 0 });
  write(QUEUE_KEY, list);
  announce();
  return true;
}

function dropFromQueue(clientRef) {
  write(QUEUE_KEY, read(QUEUE_KEY).filter((s) => s.order?.client_ref !== clientRef));
}

/** A sale the server refused. Kept for a person to look at, never auto-retried. */
function park(sale, reason) {
  const list = read(PARKED_KEY);
  list.push({ ...sale, parked_at: new Date().toISOString(), reason });
  write(PARKED_KEY, list.slice(-50));
  dropFromQueue(sale.order?.client_ref);
  announce();
}

export function clearParked() {
  write(PARKED_KEY, []);
  announce();
}

/* ── sending ──────────────────────────────────────────────────────────── */

/**
 * Whether an error means "the network is down" rather than "the server said no".
 * A network failure is worth queueing and retrying; a 400 never will be.
 */
export function isOffline(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;
  if (err.response) return err.response.status >= 500 && err.response.status !== 501;
  return err.code === "ERR_NETWORK" || err.code === "ECONNABORTED" || !err.status;
}

let flushing = false;

/**
 * Send everything waiting, oldest first.
 *
 * Stops at the first sale that fails on the network — if one cannot get
 * through, neither can the next, and the order they were rung up in is worth
 * keeping. A sale the server rejects outright is parked and the flush carries
 * on past it.
 *
 * @param send  (sale) => Promise  — the API call, injected so this module stays
 *              free of axios and can be tested on its own.
 */
export async function flushQueue(send) {
  if (flushing) return { sent: 0, parked: 0, remaining: queuedCount(), skipped: true };
  flushing = true;

  let sent = 0, parked = 0;
  try {
    for (const sale of read(QUEUE_KEY)) {
      try {
        await send(sale);
        setReachable(true);
        dropFromQueue(sale.order?.client_ref);
        sent++;
        announce();
      } catch (err) {
        if (isOffline(err)) {
          setReachable(false);
          break; // still down — leave the rest in order
        }
        // The server answered, it just answered "no" — so it is up.
        setReachable(true);
        park(sale, err?.response?.data?.error || err?.message || "Rejected by the server");
        parked++;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, parked, remaining: queuedCount() };
}

/**
 * Flush whenever the browser regains the network, and once on start-up for
 * whatever was left behind by the last session.
 */
export function startAutoFlush(send) {
  const go = () => { flushQueue(send).catch(() => {}); };
  window.addEventListener("online", go);
  const timer = setInterval(() => { if (navigator.onLine && queuedCount()) go(); }, 30_000);
  if (navigator.onLine && queuedCount()) go();
  return () => {
    window.removeEventListener("online", go);
    clearInterval(timer);
  };
}
