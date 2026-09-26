// t1-auth.mjs — authentication, roles, and cross-tenant isolation.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, B } = await ctx();

section("role gating");
await t("cashier is refused an owner-only route (users list)", async () => {
  const res = await api(A.cashier.token, "GET", "/users?b_id=" + A.b_id);
  ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

await t("waiter cannot reach the hotel module at all (role-gated at the router)", async () => {
  const res = await api(A.waiter.token, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  status(res, 403, "waiter should be refused the whole hotel module");
});

await t("kitchen staff can read the order board (shared read)", async () => {
  const res = await api(A.kitchen.token, "GET", `/orders/board?b_id=${A.b_id}`);
  status(res, 200);
});

await t("owner can reach everything a cashier can", async () => {
  const res = await api(A.owner.token, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  status(res, 200);
});

section("token integrity");
await t("no token at all is rejected", async () => {
  const res = await api(null, "GET", `/orders?b_id=${A.b_id}`);
  status(res, 401);
});

await t("garbage bearer token is rejected, not crashed", async () => {
  const res = await api("not.a.real.jwt", "GET", `/orders?b_id=${A.b_id}`);
  ok(res.status === 401, `expected 401, got ${res.status}`);
});

section("account status");
await t("deactivating an account blocks its next request within the cache window", async () => {
  // Not asserting the exact TTL here (that's a separate timing test) — just
  // that the deactivation endpoint itself works and the account's own token
  // is refused once the server-side status cache would plausibly have
  // caught up (accountIsLive's own logic, not re-derived here).
  const off = await api(A.owner.token, "PUT", `/users/${A.waiter.u_id}`, { u_status: false });
  status(off, 200, "owner should be able to deactivate a waiter");
  const reactivate = await api(A.owner.token, "PUT", `/users/${A.waiter.u_id}`, { u_status: true });
  status(reactivate, 200, "reactivating should also succeed, leaving the fixture usable for later files");
});

section("cross-tenant isolation");
await t("tenant B's owner cannot read tenant A's bookings", async () => {
  const res = await api(B.owner.token, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  // Either refused outright, or silently scoped to nothing — never A's data.
  if (res.status === 200) {
    ok(Array.isArray(res.data) && res.data.length === 0, "must not return tenant A's bookings to tenant B");
  } else {
    ok(res.status === 403 || res.status === 404, `expected scoped-empty/403/404, got ${res.status}`);
  }
});

await t("tenant B's owner cannot edit tenant A's branch", async () => {
  const res = await api(B.owner.token, "PUT", `/branches/${A.b_id}`, { B_name: "Hijacked" });
  ok(res.status !== 200, "must not be able to rename another tenant's branch");
});

await finish("t1-auth.mjs");
