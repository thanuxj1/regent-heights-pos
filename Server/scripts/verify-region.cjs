/**
 * Does the Singapore copy actually behave like the Ohio original?
 *
 * Matching row counts nearly hid a tenant leak in this project once already, so
 * this compares content, checks that every sequence will hand out an id that is
 * free, and proves a real insert works before anything is switched over.
 *
 *   node scripts/verify-region.cjs
 */
const { Pool } = require("pg");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const src = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const dst = new Pool({ connectionString: process.env.NEW_DB_URL, ssl: { rejectUnauthorized: false } });
const q = (p, t, v) => p.query(t, v).then((r) => r.rows);
const ident = (n) => '"' + String(n).replace(/"/g, '""') + '"';

let pass = 0, fail = 0;
const check = (ok, name, detail = "") => {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  [" + detail + "]" : ""));
  ok ? pass++ : fail++;
};

(async () => {
  console.log("\nVERIFYING THE SINGAPORE COPY\n");

  console.log("The odd column name survived");
  const [{ n: padded }] = await q(dst, `
    SELECT COUNT(*)::int n FROM information_schema.columns
    WHERE table_name='Branch_Product' AND column_name=' Pro_Price'`);
  check(padded === 1, 'the column really named " Pro_Price" is there', "found " + padded);

  console.log("\nContent, not counts");
  // Every row of every table, hashed, so a changed value cannot hide behind a
  // matching count.
  const tables = (await q(src, `
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`)).map((r) => r.name);

  let differing = [];
  for (const t of tables) {
    const digest = async (pool) => {
      const rows = await q(pool, `SELECT * FROM ${ident(t)}`);
      return rows
        .map((r) => JSON.stringify(r, Object.keys(r).sort()))
        .sort()
        .join("|");
    };
    const [a, b] = await Promise.all([digest(src), digest(dst)]);
    if (a !== b) differing.push(`${t} (${a.length} vs ${b.length} chars)`);
  }
  check(differing.length === 0, `all ${tables.length} tables hold identical rows`,
    differing.length ? differing.join("; ").slice(0, 160) : "byte for byte");

  console.log("\nEvery sequence will hand out a free id");
  const owned = await q(dst, `
    SELECT s.relname AS seq, c.relname AS tbl, a.attname AS col
    FROM pg_class s
    JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass
    JOIN pg_class c ON c.oid=d.refobjid
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid
    JOIN pg_namespace n ON n.oid=s.relnamespace
    WHERE s.relkind='S' AND n.nspname='public'`);

  const clashes = [];
  for (const o of owned) {
    const [{ last }] = await q(dst, `SELECT last_value AS last FROM ${ident(o.seq)}`);
    const [{ mx }] = await q(dst,
      `SELECT COALESCE(MAX(${ident(o.col)}),0) AS mx FROM ${ident(o.tbl)}`);
    if (Number(last) < Number(mx)) clashes.push(`${o.seq}: next ${last} but max id is ${mx}`);
  }
  check(clashes.length === 0, `all ${owned.length} sequences are past their table's highest id`,
    clashes.length ? clashes.join("; ").slice(0, 200) : "no id collisions waiting");

  console.log("\nA real write works end to end");
  // The proof that matters: insert, read back, remove. If sequences or defaults
  // were wrong this is where it shows, not in a count.
  let wrote = false, readBack = null;
  try {
    const ins = await q(dst,
      `INSERT INTO "ACTIVITY_LOG" (actor_name, action, entity, summary, b_id)
       VALUES ('ZZ Region Check','login','auth','verifying the Singapore copy', 10)
       RETURNING log_id, summary`);
    wrote = ins.length === 1;
    readBack = ins[0];
    await dst.query(`DELETE FROM "ACTIVITY_LOG" WHERE log_id=$1`, [readBack.log_id]);
  } catch (e) {
    check(false, "an insert succeeds", e.message.slice(0, 90));
  }
  if (wrote) {
    check(true, "an insert succeeds and gets a fresh id", "log_id " + readBack.log_id);
    const [{ n }] = await q(dst,
      `SELECT COUNT(*)::int n FROM "ACTIVITY_LOG" WHERE actor_name='ZZ Region Check'`);
    check(n === 0, "and the test row was removed again", "left " + n);
  }

  console.log("\nForeign keys are real, not decorative");
  let refused = false;
  try {
    await dst.query(`INSERT INTO "BOOKING_ROOM" (booking_id, room_id) VALUES (999999, 999999)`);
  } catch { refused = true; }
  check(refused, "a row pointing at a booking that does not exist is refused");

  console.log("\nThe source was never written to");
  const [{ n: srcRows }] = await q(src, `SELECT COUNT(*)::int n FROM "ACTIVITY_LOG"`);
  check(srcRows === 15, "Ohio still has exactly its 15 activity rows", "found " + srcRows);

  console.log("\n" + pass + " passed, " + fail + " failed");
  await src.end(); await dst.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
