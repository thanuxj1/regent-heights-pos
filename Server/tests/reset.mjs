// tests/reset.mjs — clears any previous run's leftovers before a fresh run.
// Always run this before a full suite; re-running without it produces
// duplicate-key collisions from fixed names (category, product, table…)
// that look like real regressions but aren't.
import { cleanup, pool } from "./lib.mjs";

await cleanup();
console.log("reset: done");
await pool.end();
process.exit(0);
