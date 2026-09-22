/**
 * Clear the day-to-day records so a test run starts from nothing.
 *
 *   node scripts/reset-day-to-day.js          say what would go, change nothing
 *   node scripts/reset-day-to-day.js --yes    do it
 *
 * What goes: everything a working day writes — tickets and their lines, money
 * taken, stock movements, stays, folios, guests, deliveries, cash sessions and
 * the audit trail.
 *
 * What stays: the people who sign in, the companies and properties, the menu
 * and its recipes, ingredients, suppliers, rooms, room types, meal plans,
 * categories and tables. Nobody is locked out and nothing has to be set up
 * again.
 *
 * Stock counts are set to zero rather than left where they were: the ledger
 * that explained those figures is being deleted, so any other number would
 * stand for nothing. Put stock in the way the property really would — a
 * purchase order for ingredients, or Count on the product page for the rack.
 * The main hotel's own product counts are left alone; no ledger ever explained
 * those, and zeroing them would block putting an item on a menu.
 *
 * One transaction: either the database is clean or it is untouched.
 */
import "dotenv/config";
import pool from "../config/database.js";

// Children before parents.
const WIPE = [
  "COMMISSION_RECORD",
  "STOCK_MOVEMENT",
  "ORDER_ITEM",
  "Payment",
  "ORDER",
  "FOLIO_ITEM",
  "FOLIO",
  "BOOKING_PAYMENT",
  "BOOKING_ROOM",
  "BOOKING",
  "RESERVATION",
  "GUEST",
  "purchase_item",
  "supplier_payment",
  "purchase_order",
  "discount",
  "EXPENSE",
  "CASH_MOVEMENT",
  "CASH_SESSION",
  "TABLE_ASSIGNMENT",
  "LOGIN_LOCATION",
  "ACTIVITY_LOG",
];

// So the first ticket of the test run is #1 rather than #1719.
//
// Set from what is actually left, never blindly to 1. A row can survive the
// delete above — a till or another session committing an order a moment after
// this transaction took its snapshot — and a sequence handing out 1 while a row
// sits at 1866 is a duplicate key waiting to happen. It happened: the next
// check-in came back "That already exists".
const RESTART = {
  ORDER: "or_id", ORDER_ITEM: "orderItem_id", Payment: "p_id",
  STOCK_MOVEMENT: "move_id", BOOKING: "booking_id", GUEST: "guest_id",
  FOLIO: "folio_id", FOLIO_ITEM: "item_id", CASH_SESSION: "session_id",
  ACTIVITY_LOG: "log_id",
};

const GO = process.argv.includes("--yes");

const client = await pool.connect();
try {
  const before = {};
  let total = 0;
  for (const t of WIPE) {
    const { rows } = await client.query(`SELECT COUNT(*)::int n FROM "${t}"`);
    before[t] = rows[0].n;
    total += rows[0].n;
  }

  if (!GO) {
    console.log("\nWould clear:");
    for (const t of WIPE) if (before[t]) console.log(`  ${t.padEnd(22)} ${String(before[t]).padStart(6)} rows`);
    console.log(`\n  ${total} rows in all. Nothing has been touched.`);
    console.log("  Run again with --yes to clear them.\n");
  } else {
    await client.query("BEGIN");
    for (const t of WIPE) await client.query(`DELETE FROM "${t}"`);

    const bp = await client.query(`UPDATE "Branch_Product" SET pro_quantity = 0`);
    const rm = await client.query(`UPDATE "Raw_Material" SET stock_qty = 0`);
    const rooms = await client.query(`UPDATE "ROOM" SET hk_status = 'clean' WHERE hk_status <> 'clean'`);
    const pins = await client.query(`UPDATE "User" SET u_approval_pin = NULL WHERE u_approval_pin IS NOT NULL`);

    await client.query("COMMIT");

    // Only now, and each in its own statement.
    //
    // This ran inside the transaction above, and twice it took the whole delete
    // down with it: a statement that fails inside a transaction poisons it, and
    // the COMMIT that follows quietly becomes a rollback — the script then
    // printed everything it had "cleared" while the database still held it all.
    // Outside the transaction the worst a bad sequence name can do is leave one
    // sequence alone.
    let survivors = 0;
    for (const [table, col] of Object.entries(RESTART)) {
      try {
        const { rows } = await client.query(
          `SELECT COALESCE(MAX("${col}"), 0)::int AS high FROM "${table}"`);
        const high = Number(rows[0].high);
        if (high > 0) survivors += 1;
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', '${col}'),
                         GREATEST($1::bigint, 1), $2)`,
          [high || 1, high > 0]);
      } catch (e) {
        console.warn(`  [ids] ${table}.${col} left as it was — ${e.message}`);
      }
    }
    if (survivors) {
      console.warn(`
  ${survivors} table(s) still hold rows written while this was running —`);
      console.warn("  their ids carry on from where those rows end, not from 1.");
    }

    console.log("\nCleared:");
    for (const t of WIPE) if (before[t]) console.log(`  ${t.padEnd(22)} ${String(before[t]).padStart(6)} rows`);
    console.log("\nReset:");
    console.log(`  menu stock counts        ${bp.rowCount} item(s) to zero`);
    console.log(`  ingredient stock         ${rm.rowCount} item(s) to zero`);
    console.log(`  rooms put back to clean  ${rooms.rowCount}`);
    console.log(`  approval PINs cleared    ${pins.rowCount}`);
    console.log("  ids restart at 1 for tickets, payments, stays, guests and the log\n");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\nNothing was deleted —", err.message, "\n");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
