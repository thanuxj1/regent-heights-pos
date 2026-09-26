// t6-tables.mjs — tables, table assignments, and reservations.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const waiter = A.waiter.token;
const cashier = A.cashier.token;

let tableId, custId;

section("tables");
await t("owner creates a table", async () => {
  const res = await api(owner, "POST", "/tables", { table_number: "ZZQA-T1", table_capacity: 4, branch_id: A.b_id });
  status(res, 201);
  tableId = res.data.table_id ?? res.data.data?.table_id;
  ok(tableId, "response should carry the new table_id");
});

await t("waiter cannot create a table (needs Tables & Assignments management)", async () => {
  const res = await api(waiter, "POST", "/tables", { table_number: "ZZQA-T2", table_capacity: 2, branch_id: A.b_id });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("the whole /tables module is capability-gated — a waiter can't even read it (TABLES_MANAGEMENT has no default access for anyone but an owner)", async () => {
  const res = await api(waiter, "GET", `/tables?branch_id=${A.b_id}`);
  status(res, 403, "this documents current behavior — the floor's own read access is table-assignments, not /tables itself");
});

section("table assignments");
await t("owner assigns the waiter to the table for tomorrow's morning shift", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const res = await api(owner, "POST", "/table-assignments", {
    table_id: tableId, u_id: A.waiter.u_id, assigned_date: tomorrow, shift: "morning",
  });
  status(res, 201);
});

await t("waiter can read their own assignments", async () => {
  const res = await api(waiter, "GET", `/table-assignments?u_id=${A.waiter.u_id}`);
  status(res, 200);
});

section("reservations");
await t("owner creates a customer for the reservation", async () => {
  const res = await api(owner, "POST", "/customers", { cust_name: "ZZQA Walk-in Customer", cust_phone: "0719999999" });
  status(res, 201);
  custId = res.data.cust_id ?? res.data.data?.cust_id;
  ok(custId, "response should carry the new cust_id");
});

let reservId;
await t("cashier books a reservation for that table", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const res = await api(cashier, "POST", "/reservations", {
    reserv_date: tomorrow, reserv_time: "19:00", cust_id: custId, table_id: tableId, branch_id: A.b_id, duration_minutes: 90,
  });
  status(res, 201);
  reservId = res.data.reserv_id ?? res.data.data?.reserv_id;
});

await t("the reservation shows up when listed", async () => {
  const res = await api(cashier, "GET", `/reservations?branch_id=${A.b_id}`);
  status(res, 200);
  const list = Array.isArray(res.data) ? res.data : res.data.data;
  ok(list.some((r) => (r.reserv_id ?? r.id) === reservId), "the new reservation should be in the list");
});

await finish("t6-tables.mjs");
