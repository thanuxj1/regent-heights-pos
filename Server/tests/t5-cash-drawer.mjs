// t5-cash-drawer.mjs — the drawer PIN and a cash session's open/movement/close.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

section("drawer locked until a PIN is set");
await t("opening a session before any drawer PIN is set is refused (423 locked)", async () => {
  const res = await api(cashier, "POST", "/cash/session/open", { b_id: A.b_id, opening_float: 5000 });
  status(res, 423, "the drawer should stay locked with no PIN set yet");
});

await t("owner sets the drawer PIN", async () => {
  const res = await api(owner, "PUT", "/cash/pin", { pin: "13579", b_id: A.b_id });
  status(res, 200);
});

section("session lifecycle");
await t("opening a session with the wrong PIN is refused", async () => {
  const res = await api(cashier, "POST", "/cash/session/open", { b_id: A.b_id, opening_float: 5000 }, { "X-Drawer-Pin": "00000" });
  ok(res.status !== 200 && res.status !== 201, "wrong drawer PIN must not open the session");
});

await t("opening a session with the real PIN succeeds", async () => {
  const res = await api(cashier, "POST", "/cash/session/open", { b_id: A.b_id, opening_float: 5000 }, { "X-Drawer-Pin": "13579" });
  ok(res.status === 200 || res.status === 201, `expected success, got ${res.status} — ${JSON.stringify(res.data)}`);
});

await t("a second open while one is already open is refused", async () => {
  const res = await api(cashier, "POST", "/cash/session/open", { b_id: A.b_id, opening_float: 1000 }, { "X-Drawer-Pin": "13579" });
  status(res, 409, "a cashier with an open drawer should not be able to open a second one");
});

await t("reading the current session works (soft PIN check — no header needed to just look)", async () => {
  const res = await api(cashier, "GET", `/cash/session?b_id=${A.b_id}`);
  status(res, 200);
});

await t("a pay-out movement against the open drawer succeeds with the right PIN", async () => {
  const res = await api(cashier, "POST", "/cash/session/movement",
    { b_id: A.b_id, kind: "pay_out", amount: 500, reason: "ZZQA test payout" },
    { "X-Drawer-Pin": "13579" });
  ok(res.status === 200 || res.status === 201, `expected success, got ${res.status} — ${JSON.stringify(res.data)}`);
});

await t("closing the session with the wrong PIN is refused", async () => {
  const res = await api(cashier, "POST", "/cash/session/close", { b_id: A.b_id, counted_cash: 4500 }, { "X-Drawer-Pin": "wrong" });
  ok(res.status !== 200, "wrong PIN must not be able to close the drawer");
});

await t("closing the session with the real PIN succeeds", async () => {
  const res = await api(cashier, "POST", "/cash/session/close", { b_id: A.b_id, counted_cash: 4500 }, { "X-Drawer-Pin": "13579" });
  ok(res.status === 200 || res.status === 201, `expected success, got ${res.status} — ${JSON.stringify(res.data)}`);
});

section("owner-only review");
await t("cashier cannot list every drawer session (needs Cash Drawer Administration)", async () => {
  const res = await api(cashier, "GET", `/cash/sessions?b_id=${A.b_id}`);
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("owner can list every drawer session", async () => {
  const res = await api(owner, "GET", `/cash/sessions?b_id=${A.b_id}`);
  status(res, 200);
});

await finish("t5-cash-drawer.mjs");
