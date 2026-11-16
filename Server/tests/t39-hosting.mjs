// t39-hosting.mjs — the shop is told before the yearly hosting runs out.
//
// The date is one row. Everyone signed in can read it; only a Super Admin can
// mark a year paid, so the reminder cannot be switched off from the shop.
import jwt from "jsonwebtoken";
import { ctx, api, pool, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hostingState } from "../controllers/hostingController.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

const email = `${stamp}_sa@example.test`.toLowerCase();
const u = await pool.query(
  `INSERT INTO "User" (u_fname, u_lname, u_email, u_pw, role_id, u_status) VALUES ($1, 'SA', $2, 'x', 6, TRUE) RETURNING u_id`,
  [stamp, email],
);
const sa = jwt.sign({ u_id: u.rows[0].u_id, role_id: 6, u_email: email, b_id: null, com_id: null },
  process.env.JWT_SECRET, { expiresIn: "1h" });

const kept = (await pool.query("SELECT paid_until::text AS d FROM hosting_plan WHERE id = 1")).rows[0]?.d;

section("When the shop is told");

await t("more than two months out: nothing", () => {
  eq(hostingState("2027-10-24", "2027-08-23").stage, "ok");
});
await t("two months out: the first notice", () => {
  const s = hostingState("2027-10-24", "2027-08-25");
  eq(s.stage, "two_months");
  eq(s.days_left, 60);
});
await t("the last month: every day", () => {
  eq(hostingState("2027-10-24", "2027-09-24").stage, "daily");
  eq(hostingState("2027-10-24", "2027-10-24").days_left, 0);
  eq(hostingState("2027-10-24", "2027-10-24").stage, "daily");
});
await t("past the date: expired, and it keeps saying so", () => {
  const s = hostingState("2027-10-24", "2027-10-30");
  eq(s.stage, "expired");
  eq(s.days_left, -6);
});

section("Who may see and who may tick");

await t("the cashier and the owner can read the date", async () => {
  const c = await api(cashier, "GET", "/hosting");
  status(c, 200);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(c.data.paid_until), "a plain date");
  status(await api(owner, "GET", "/hosting"), 200);
});
await t("nobody signed out reads it", async () => {
  status(await api(null, "GET", "/hosting"), 401);
});
await t("the owner cannot mark it paid", async () => {
  status(await api(owner, "POST", "/hosting/paid", {}), 403);
  status(await api(cashier, "POST", "/hosting/paid", { paid_until: "2099-01-01" }), 403);
});

section("Marking a year paid");

await t("Paid adds twelve months to the date it was paid up to", async () => {
  status(await api(sa, "POST", "/hosting/paid", { paid_until: "2027-10-24" }), 200);
  const res = await api(sa, "POST", "/hosting/paid", {});
  status(res, 200);
  eq(res.data.paid_until, "2028-10-24");
  eq((await api(cashier, "GET", "/hosting")).data.paid_until, "2028-10-24", "the till sees it");
});
await t("a wrong date is turned down", async () => {
  status(await api(sa, "POST", "/hosting/paid", { paid_until: "24-10-2027" }), 400);
});
await t("it goes on the activity log", async () => {
  const { rows } = await pool.query(
    `SELECT summary FROM "ACTIVITY_LOG" WHERE action = 'hosting_paid' AND u_id = $1 ORDER BY 1 DESC`, [u.rows[0].u_id]);
  ok(rows.some((r) => r.summary.includes("2028-10-24")));
});

if (kept) await pool.query("UPDATE hosting_plan SET paid_until = $1 WHERE id = 1", [kept]);
await pool.query(`DELETE FROM "ACTIVITY_LOG" WHERE u_id = $1`, [u.rows[0].u_id]);
await pool.query(`DELETE FROM "User" WHERE u_id = $1`, [u.rows[0].u_id]);
await finish("t39-hosting.mjs");
