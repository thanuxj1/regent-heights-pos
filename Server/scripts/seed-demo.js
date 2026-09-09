/**
 * Demo data so every screen has something to look at.
 *
 *   node scripts/seed-demo.js <branchId>     seed that branch
 *   node scripts/seed-demo.js <branchId> --clear   remove it again
 *
 * Everything created is tagged DEMO_TAG, so --clear removes exactly what this
 * script made and never touches real records.
 */
import "dotenv/config";
import pool from "../config/database.js";

const DEMO_TAG = "[demo]";
const branchId = Number(process.argv[2]);
const CLEAR = process.argv.includes("--clear");

if (!branchId) {
  console.error("Usage: node scripts/seed-demo.js <branchId> [--clear]");
  process.exit(1);
}

const ymd = (d) => d.toISOString().slice(0, 10);
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const money = (n) => `LKR ${Number(n).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`;

async function clearDemo(client) {
  // Order matters: children before parents.
  await client.query(`
    DELETE FROM "ORDER_ITEM" WHERE order_id IN (
      SELECT o.or_id FROM "ORDER" o
      JOIN "FOLIO" f ON f.folio_id = o.folio_id
      JOIN "BOOKING" b ON b.booking_id = f.booking_id
      WHERE b.remarks LIKE $1)`, [`%${DEMO_TAG}%`]);
  await client.query(`
    DELETE FROM "ORDER" WHERE folio_id IN (
      SELECT f.folio_id FROM "FOLIO" f
      JOIN "BOOKING" b ON b.booking_id = f.booking_id
      WHERE b.remarks LIKE $1)`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "BOOKING" WHERE remarks LIKE $1`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "GUEST"   WHERE notes   LIKE $1`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "COMMISSION_RECORD" WHERE notes LIKE $1`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "COMMISSION_AGENT"  WHERE notes LIKE $1`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "EXPENSE" WHERE exp_description LIKE $1`, [`%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "ROOM"      WHERE b_id = $1 AND notes       LIKE $2`, [branchId, `%${DEMO_TAG}%`]);
  await client.query(`DELETE FROM "ROOM_TYPE" WHERE b_id = $1 AND description LIKE $2`, [branchId, `%${DEMO_TAG}%`]);
}

const ROOM_TYPES = [
  { type_name: "Standard Double", type_code: "DBL", base_rate: 12000, base_occupancy: 2, max_occupancy: 3,
    bed_config: "1 Queen Bed", size_sqft: 280,
    description: `Comfortable double with garden views. ${DEMO_TAG}`,
    amenities: ["Air Conditioning", "Free WiFi", "Flat-screen TV", "Hair Dryer", "Tea/Coffee Maker"] },
  { type_name: "Deluxe Double", type_code: "DLX", base_rate: 18000, base_occupancy: 2, max_occupancy: 3,
    bed_config: "1 King Bed", size_sqft: 380,
    description: `Spacious deluxe with balcony and hill views. ${DEMO_TAG}`,
    amenities: ["Air Conditioning", "Free WiFi", "Flat-screen TV", "Minibar", "Balcony", "Mountain View", "Safe"] },
  { type_name: "Luxury Suite", type_code: "STE", base_rate: 32000, base_occupancy: 2, max_occupancy: 4,
    bed_config: "1 King + Sofa Bed", size_sqft: 620,
    description: `Two-room suite with lounge and bathtub. ${DEMO_TAG}`,
    amenities: ["Air Conditioning", "Free WiFi", "Flat-screen TV", "Minibar", "Balcony", "Bathtub", "Safe", "Work Desk", "Room Service"] },
  { type_name: "Single Room", type_code: "SGL", base_rate: 8000, base_occupancy: 1, max_occupancy: 2,
    bed_config: "1 Single Bed", size_sqft: 180,
    description: `Compact single, ideal for solo travellers. ${DEMO_TAG}`,
    amenities: ["Air Conditioning", "Free WiFi", "Flat-screen TV", "Shower"] },
];

const ROOMS = [
  ["101", "1", "Standard Double"], ["102", "1", "Standard Double"], ["103", "1", "Single Room"],
  ["104", "1", "Deluxe Double"],   ["105", "1", "Standard Double"],
  ["201", "2", "Deluxe Double"],   ["202", "2", "Deluxe Double"],   ["203", "2", "Standard Double"],
  ["204", "2", "Luxury Suite"],    ["205", "2", "Single Room"],
  ["301", "3", "Luxury Suite"],    ["302", "3", "Deluxe Double"],
];

const GUESTS = [
  { full_name: "Boubadra Zakaria", phone: "0771234567", email: "bzakaria@example.com",
    country: "Algeria", nationality: "Algerian", passport_nic: "AX9912345", guest_status: "VIP" },
  { full_name: "Nimal Perera", phone: "0712223344", email: "nimal.p@example.com",
    country: "Sri Lanka", nationality: "Sri Lankan", passport_nic: "912345678V" },
  { full_name: "Emma Schmidt", phone: "0763334455", email: "emma.s@example.com",
    country: "Germany", nationality: "German", passport_nic: "C01X9911Z" },
  { full_name: "Kenji Tanaka", phone: "0754445566", email: "k.tanaka@example.com",
    country: "Japan", nationality: "Japanese", passport_nic: "TK8877221" },
  { full_name: "Aisha Rahman", phone: "0775556677", email: "aisha.r@example.com",
    country: "Maldives", nationality: "Maldivian", passport_nic: "MV223344" },
  { full_name: "Oliver Hughes", phone: "0716667788", email: "o.hughes@example.com",
    country: "United Kingdom", nationality: "British", passport_nic: "GB9081726" },
];

const AGENTS = [
  { agent_name: "Thanuja Weerasekara", agent_phone: "0777001122", agent_email: "thanuja@example.com", commission_rate: 12 },
  { agent_name: "Kandy City Tours",    agent_phone: "0812233445", agent_email: "info@kandycitytours.example", commission_rate: 10 },
  { agent_name: "Ceylon Trails",       agent_phone: "0779988776", agent_email: "book@ceylontrails.example", commission_rate: 15 },
];

const EXPENSES = [
  ["utilities", 48500, "Electricity — monthly"], ["utilities", 12400, "Water — monthly"],
  ["salary", 285000, "Staff salaries"],          ["raw_materials", 96000, "Kitchen provisions"],
  ["maintenance", 32000, "AC servicing, 6 units"], ["marketing", 18000, "Online listing fees"],
  ["raw_materials", 44500, "Fresh produce restock"], ["maintenance", 15600, "Plumbing repair, 2nd floor"],
  ["other", 9800, "Guest amenities restock"],     ["delivery", 7200, "Laundry collection"],
];

async function main() {
  const client = await pool.connect();
  try {
    const br = await client.query('SELECT "B_id","B_name" FROM "Branch" WHERE "B_id"=$1', [branchId]);
    if (!br.rows.length) throw new Error(`Branch ${branchId} does not exist`);
    console.log(`Branch ${branchId} — ${br.rows[0].B_name}\n`);

    await client.query("BEGIN");
    await clearDemo(client);
    if (CLEAR) {
      await client.query("COMMIT");
      console.log("Demo data removed.");
      return;
    }

    const staff = await client.query('SELECT u_id FROM "User" WHERE "B_id"=$1 LIMIT 1', [branchId]);
    const uid = staff.rows[0]?.u_id ?? null;

    // ─── Room types ───────────────────────────────────────────────
    const typeIds = {};
    for (const t of ROOM_TYPES) {
      const { rows } = await client.query(
        `INSERT INTO "ROOM_TYPE" (b_id, type_name, type_code, description, base_occupancy, max_occupancy,
                                  base_rate, extra_adult_rate, extra_child_rate, bed_config, size_sqft, amenities)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING room_type_id`,
        [branchId, t.type_name, t.type_code, t.description, t.base_occupancy, t.max_occupancy,
         t.base_rate, 3000, 1500, t.bed_config, t.size_sqft, JSON.stringify(t.amenities)]
      );
      typeIds[t.type_name] = rows[0].room_type_id;
    }
    console.log(`✓ ${ROOM_TYPES.length} room types`);

    // ─── Rooms (a couple left dirty so housekeeping has work) ──────
    const roomIds = {};
    for (const [number, floor, typeName] of ROOMS) {
      const hk = ["103", "205"].includes(number) ? "dirty"
               : number === "302" ? "maintenance" : "clean";
      const { rows } = await client.query(
        `INSERT INTO "ROOM" (b_id, room_type_id, room_number, floor, hk_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING room_id`,
        [branchId, typeIds[typeName], number, floor, hk, DEMO_TAG]
      );
      roomIds[number] = rows[0].room_id;
    }
    console.log(`✓ ${ROOMS.length} rooms`);

    // ─── Guests ───────────────────────────────────────────────────
    const guestIds = {};
    for (const g of GUESTS) {
      const { rows } = await client.query(
        `INSERT INTO "GUEST" (full_name, phone, email, country, nationality, passport_nic, guest_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING guest_id`,
        [g.full_name, g.phone, g.email, g.country, g.nationality, g.passport_nic,
         g.guest_status || null, DEMO_TAG]
      );
      guestIds[g.full_name] = rows[0].guest_id;
    }
    console.log(`✓ ${GUESTS.length} guests`);

    // ─── Commission agents ────────────────────────────────────────
    const agentIds = {};
    for (const a of AGENTS) {
      const { rows } = await client.query(
        `INSERT INTO "COMMISSION_AGENT" (agent_name, agent_phone, agent_email, b_id, commission_rate, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING agent_id`,
        [a.agent_name, a.agent_phone, a.agent_email, branchId, a.commission_rate, DEMO_TAG]
      );
      agentIds[a.agent_name] = rows[0].agent_id;
    }
    console.log(`✓ ${AGENTS.length} commission agents`);

    const plans = await client.query('SELECT plan_id, plan_code FROM "MEAL_PLAN" WHERE b_id=$1', [branchId]);
    const plan = (code) => plans.rows.find(p => p.plan_code === code)?.plan_id ?? null;

    // ─── Bookings across every status ─────────────────────────────
    // in-house now, arriving today, future, past (checked out), cancelled
    const BOOKINGS = [
      { guest: "Boubadra Zakaria", room: "204", ci: shift(-1), co: shift(2), status: "checked_in",
        plan: "HB", adults: 2, source: "phone", agent: "Thanuja Weerasekara", advance: 20000,
        special: "Honeymoon decoration & cake" },
      { guest: "Emma Schmidt", room: "201", ci: shift(-2), co: shift(1), status: "checked_in",
        plan: "BB", adults: 2, source: "ota", advance: 30000 },
      { guest: "Kenji Tanaka", room: "103", ci: shift(0), co: shift(3), status: "confirmed",
        plan: "BB", adults: 1, source: "online", advance: 8000 },
      { guest: "Aisha Rahman", room: "301", ci: shift(0), co: shift(4), status: "confirmed",
        plan: "FB", adults: 2, children: 1, source: "agent", agent: "Ceylon Trails", advance: 40000 },
      { guest: "Oliver Hughes", room: "202", ci: shift(4), co: shift(7), status: "confirmed",
        plan: "HB", adults: 2, source: "ota", agent: "Kandy City Tours", advance: 0 },
      { guest: "Nimal Perera", room: "101", ci: shift(6), co: shift(8), status: "tentative",
        plan: "RO", adults: 2, source: "walk_in", advance: 0 },
      { guest: "Nimal Perera", room: "102", ci: shift(-14), co: shift(-11), status: "checked_out",
        plan: "HB", adults: 2, source: "phone", advance: 0, settled: true },
      { guest: "Emma Schmidt", room: "104", ci: shift(-30), co: shift(-27), status: "checked_out",
        plan: "BB", adults: 2, source: "ota", advance: 0, settled: true },
      { guest: "Oliver Hughes", room: "205", ci: shift(3), co: shift(5), status: "cancelled",
        plan: "RO", adults: 1, source: "online", advance: 0 },
    ];

    let made = 0, folios = 0;
    for (const b of BOOKINGS) {
      const typeName = ROOMS.find(r => r[0] === b.room)[2];
      const rate = ROOM_TYPES.find(t => t.type_name === typeName).base_rate;
      const nights = Math.round((new Date(b.co) - new Date(b.ci)) / 86400000);
      const mp = plan(b.plan);
      const mpRow = mp ? (await client.query('SELECT * FROM "MEAL_PLAN" WHERE plan_id=$1', [mp])).rows[0] : null;

      const roomCharges = rate * nights;
      const mealCharges = mpRow
        ? ((b.adults || 1) * Number(mpRow.supplement_per_adult) +
           (b.children || 0) * Number(mpRow.supplement_per_child)) * nights
        : 0;
      const tax = roomCharges * 0.1;
      const grand = roomCharges + tax + mealCharges;

      const seq = await client.query("SELECT nextval('booking_ref_seq') AS n");
      const ref = `RH-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(4, "0")}`;

      const { rows } = await client.query(
        `INSERT INTO "BOOKING"
           (booking_ref, b_id, guest_id, agent_id, source, check_in_date, check_out_date, nights,
            adults, children, meal_plan_id, special_requests, status, room_charges, meal_charges,
            tax_pct, tax_amount, grand_total, advance_paid, remarks, taken_by,
            checked_in_at, checked_out_at, cancelled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,10,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING booking_id`,
        [ref, branchId, guestIds[b.guest], b.agent ? agentIds[b.agent] : null, b.source,
         b.ci, b.co, nights, b.adults || 1, b.children || 0, mp, b.special || null, b.status,
         roomCharges, mealCharges, tax, grand, b.advance || 0, DEMO_TAG, uid,
         ["checked_in", "checked_out"].includes(b.status) ? new Date(b.ci) : null,
         b.status === "checked_out" ? new Date(b.co) : null,
         b.status === "cancelled" ? new Date() : null]
      );
      const bookingId = rows[0].booking_id;
      made++;

      await client.query(
        `INSERT INTO "BOOKING_ROOM" (booking_id, room_id, room_type_id, rate_per_night, adults, children)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bookingId, roomIds[b.room], typeIds[typeName], rate, b.adults || 1, b.children || 0]
      );

      if (b.advance > 0) {
        await client.query(
          `INSERT INTO "BOOKING_PAYMENT" (booking_id, amount, method, kind, received_by)
           VALUES ($1,$2,'cash','advance',$3)`, [bookingId, b.advance, uid]);
      }

      // Folios for anyone who actually arrived
      if (["checked_in", "checked_out"].includes(b.status)) {
        const f = await client.query(
          `INSERT INTO "FOLIO" (booking_id, status, closed_at) VALUES ($1,$2,$3) RETURNING folio_id`,
          [bookingId, b.status === "checked_out" ? "closed" : "open",
           b.status === "checked_out" ? new Date(b.co) : null]);
        const folioId = f.rows[0].folio_id;
        folios++;

        const post = (source, desc, qty, unit, amount, date) => client.query(
          `INSERT INTO "FOLIO_ITEM" (folio_id, source, description, qty, unit_price, amount, item_date, posted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [folioId, source, desc, qty, unit, amount, date, uid]);

        await post("room", `Room ${b.room} (${typeName}) × ${nights} night(s)`, nights, rate, roomCharges, b.ci);
        if (mealCharges > 0) await post("meal", `${mpRow.plan_name} — ${b.adults} adult(s) × ${nights} night(s)`, 1, mealCharges, mealCharges, b.ci);
        await post("tax", "Room charges tax (10%)", 1, tax, tax, b.ci);

        // A couple of incidentals so the folio looks lived-in
        if (b.guest === "Boubadra Zakaria") {
          await post("laundry", "Laundry — 4 items", 4, 450, 1800, shift(0));
          await post("minibar", "Minibar — soft drinks", 3, 350, 1050, shift(0));
        }
        if (b.status === "checked_out") {
          const total = roomCharges + mealCharges + tax;
          await client.query(
            `INSERT INTO "BOOKING_PAYMENT" (booking_id, amount, method, kind, received_by)
             VALUES ($1,$2,'card','settlement',$3)`, [bookingId, total - (b.advance || 0), uid]);
        }
      }
    }
    console.log(`✓ ${made} bookings (${folios} folios)`);

    // ─── Commission records ───────────────────────────────────────
    let commissions = 0;
    const withAgents = await client.query(
      `SELECT booking_id, agent_id, grand_total, check_in_date FROM "BOOKING"
       WHERE remarks LIKE $1 AND agent_id IS NOT NULL`, [`%${DEMO_TAG}%`]);
    for (const b of withAgents.rows) {
      const rate = AGENTS.find(a => agentIds[a.agent_name] === b.agent_id)?.commission_rate ?? 10;
      const amount = +(Number(b.grand_total) * rate / 100).toFixed(2);
      await client.query(
        `INSERT INTO "COMMISSION_RECORD" (agent_id, order_id, commission_amount, record_date, notes, status)
         VALUES ($1,NULL,$2,$3,$4,$5)`,
        [b.agent_id, amount, b.check_in_date, `Booking commission ${DEMO_TAG}`,
         new Date(b.check_in_date) < new Date() ? "paid" : "pending"]);
      commissions++;
    }
    console.log(`✓ ${commissions} commission records`);

    // ─── Expenses spread over the last month ──────────────────────
    for (let i = 0; i < EXPENSES.length; i++) {
      const [cat, amt, desc] = EXPENSES[i];
      await client.query(
        `INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [branchId, cat, amt, `${desc} ${DEMO_TAG}`, shift(-(i * 3 + 1)), uid]);
    }
    console.log(`✓ ${EXPENSES.length} expenses`);

    await client.query("COMMIT");

    const rev = await pool.query(
      `SELECT COALESCE(SUM(fi.amount),0) t FROM "FOLIO_ITEM" fi
       JOIN "FOLIO" f ON f.folio_id=fi.folio_id
       JOIN "BOOKING" b ON b.booking_id=f.booking_id WHERE b.b_id=$1`, [branchId]);

    console.log(`\nDone. Hotel revenue on the books: ${money(rev.rows[0].t)}`);
    console.log(`Rooms 103 and 205 are dirty, 302 is under maintenance — housekeeping has work.`);
    console.log(`\nRemove it all again with:  node scripts/seed-demo.js ${branchId} --clear`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().then(() => pool.end()).catch(e => { console.error("\nFAILED:", e.message); pool.end(); process.exit(1); });
