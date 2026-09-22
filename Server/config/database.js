import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pkg from "pg";
import { HOTEL_TZ } from "../utils/hotelTime.js";

// Same reason as server.js: resolve .env from the Server directory itself.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const { Pool } = pkg;

/**
 * The pool is tuned for a property that is quiet most of the day.
 *
 * Opening a connection to Neon costs far more than any query does — measured at
 * 0.6–2.2s against Singapore, and 3.6–12.4s against the old Ohio project, versus
 * roughly 80ms for a query on a connection that is already open. The pg default
 * closes an idle connection after ten seconds, so a till that rings up a sale
 * once a minute was paying that opening cost on *every* page load. It looked
 * like a slow database; it was actually a cold one, over and over.
 *
 * So: idle connections are kept, not dropped, and TCP keepalive stops anything
 * in between quietly closing them.
 */
/**
 * Neon's URL carries `sslmode=require`, and pg now prints eight lines warning
 * that the meaning of that word changes in its next major version. TLS here is
 * decided by the `ssl` option below, not by the URL, so the parameter does
 * nothing except shout over whatever a script is trying to say — a password
 * prompt, for one. Dropped from the string; the connection is unchanged.
 */
const connectionString = String(process.env.DATABASE_URL || "")
  .replace(/([?&])sslmode=[^&]*&?/i, (_m, lead) => (lead === "?" ? "?" : "&"))
  .replace(/[?&]$/, "");

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },

  max: 10,
  // Close our own idle connections well before Neon closes them for us.
  //
  // Holding them open indefinitely (idleTimeoutMillis: 0) looked like the
  // obvious win and was actively dangerous: Neon drops an idle pooled
  // connection from its side, and the resulting error arrived on a client
  // nobody was listening to and took the whole server process down mid-test.
  // Thirty seconds is comfortably inside any server-side timeout, so the drop
  // is always ours to make. The cost is that the first request after a quiet
  // spell reopens a connection; that is a slow page, not a dead till.
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Fail a genuinely stuck connection rather than leaving a cashier waiting
  // forever with a customer in front of them.
  connectionTimeoutMillis: 15_000,
  // Shows up in Neon's dashboard, so it is obvious which app holds a connection.
  application_name: "regent-heights-pos",

  // Every session runs on the hotel's clock. Neon defaults to GMT, which made
  // CURRENT_DATE — and therefore overstay detection, arrivals and every report
  // grouped by day — a day behind between midnight and 05:30 in Kandy.
  options: `-c timezone=${HOTEL_TZ}`,
});

// An idle connection dropped by the far end must never take the process down;
// the pool simply opens another next time one is asked for.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

// The pool's own handler only covers clients sitting idle in it. A client that
// is checked out — inside a booking transaction, say — emits its error on
// itself, and in Node an 'error' event with no listener is a fatal,
// process-ending throw. That is exactly how the server died under load once.
//
// 'connect' fires for every new client the pool makes, which is the one place
// to attach a listener that covers the client for its whole life, checked out
// or idle. The in-flight query still rejects, so callers handle the failure
// exactly as they did before.
pool.on("connect", (client) => {
  client.on("error", (err) => {
    console.error("[db] client error:", err.message);
  });
});

/**
 * Open a handful of connections at boot and hold them.
 *
 * One page of the POS fires five requests at once, and each needs its own
 * connection. Measured on a warm pool a request takes ~94ms; the same five
 * arriving on a cold pool took 918ms, because four of them had to open a
 * connection first. Nobody should pay that, least of all the first cashier of
 * the morning with a guest waiting.
 *
 * The connections are grabbed together and only released once they all exist,
 * or the pool hands back the same one five times and warms nothing.
 */
export async function warmPool(count = 5) {
  const started = Date.now();
  let clients = [];
  try {
    clients = await Promise.all(
      Array.from({ length: count }, () => pool.connect()),
    );
    await Promise.all(clients.map((c) => c.query("SELECT 1")));
    return { ok: true, opened: clients.length, ms: Date.now() - started };
  } catch (err) {
    // Never block start-up on this — the server is still perfectly usable, the
    // first few requests are just slower.
    return { ok: false, opened: clients.length, ms: Date.now() - started, error: err.message };
  } finally {
    clients.forEach((c) => c.release());
  }
}

export default pool;
