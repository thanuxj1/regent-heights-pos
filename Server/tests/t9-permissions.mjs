// t9-permissions.mjs — capability grants, default-permission revocations
// (both the write path and the actual enforcement they're supposed to
// cause), the approval PIN's own read endpoint, and a formal regression
// test for the concurrent-write race that was found and fixed this session.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, B } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const cashierId = A.cashier.u_id;

section("capability grants — extra access beyond the role");
await t("a cashier is refused Reports & Accounting before any grant", async () => {
  const res = await api(cashier, "GET", `/reports/summary?b_id=${A.b_id}`);
  ok(res.status === 403, `expected 403 before any grant, got ${res.status}`);
});

await t("owner grants reports_accounting to the cashier", async () => {
  const res = await api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: ["reports_accounting"] });
  status(res, 200);
  eq(res.data.capabilities, ["reports_accounting"]);
});

await t("the cashier's own capability read reflects the grant", async () => {
  const res = await api(cashier, "GET", `/users/${cashierId}/capabilities`);
  status(res, 200);
  ok(res.data.capabilities.includes("reports_accounting"), "the grant should be visible to the cashier themselves");
});

await t("the cashier can now read the reports summary", async () => {
  const res = await api(cashier, "GET", `/reports/summary?b_id=${A.b_id}`);
  status(res, 200, "the capability grant should actually unlock the route, not just the database row");
});

await t("a DIFFERENT cashier in a different tenant is unaffected by this grant", async () => {
  const res = await api(B.cashier.token, "GET", `/reports/summary?b_id=${B.b_id}`);
  ok(res.status === 403, "tenant B's cashier must still be refused — capability grants must not leak across tenants");
});

await t("owner revokes it again", async () => {
  const res = await api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: [] });
  status(res, 200);
  eq(res.data.capabilities, []);
});

await t("the cashier is refused again once revoked", async () => {
  const res = await api(cashier, "GET", `/reports/summary?b_id=${A.b_id}`);
  ok(res.status === 403, "revoking the grant should actually take the access away again");
});

section("default-permission revocations — taking away what the role gives by default");
await t("the cashier can use the hotel module by default (no toggle needed)", async () => {
  const res = await api(cashier, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  status(res, 200);
});

await t("owner switches off the cashier's Hotel Front Desk default", async () => {
  const res = await api(owner, "PUT", `/users/${cashierId}/default-permissions`, { revoked: ["default_hotel_front_desk"] });
  status(res, 200);
  eq(res.data.revoked, ["default_hotel_front_desk"]);
});

await t("the cashier is now refused the hotel module", async () => {
  const res = await api(cashier, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  status(res, 403, "switching the default off should actually block the route");
});

await t("a different default (Own Cash Drawer) is untouched by that one toggle", async () => {
  const res = await api(cashier, "GET", `/cash/session?b_id=${A.b_id}`);
  status(res, 200, "revoking one default must not silently affect an unrelated one");
});

await t("restoring the default (empty revoked list) gives the hotel module back", async () => {
  const res = await api(owner, "PUT", `/users/${cashierId}/default-permissions`, { revoked: [] });
  status(res, 200);
  const check = await api(cashier, "GET", `/hotel/bookings?b_id=${A.b_id}`);
  status(check, 200, "clearing the revocation should restore the default access");
});

await t("a Waiter's own default key cannot be revoked on a Cashier account (role mismatch is refused)", async () => {
  const res = await api(owner, "PUT", `/users/${cashierId}/default-permissions`, { revoked: ["default_orders"] });
  ok(res.status === 400, `expected 400 (default_orders belongs to the Waiter role, not Cashier), got ${res.status}`);
});

section("approval PIN — the security overview endpoint");
await t("nobody has a PIN set yet for this fresh tenant", async () => {
  const res = await api(owner, "GET", "/security/overview");
  status(res, 200);
  eq(res.data.your_pin_is_set, false);
  eq(res.data.managers_who_can_approve, 0);
});

await t("setting one updates the overview immediately", async () => {
  await api(owner, "PUT", "/security/approval-pin", { pin: "112233" });
  const res = await api(owner, "GET", "/security/overview");
  eq(res.data.your_pin_is_set, true);
  eq(res.data.managers_who_can_approve, 1);
});

await t("a cashier can never set an approval PIN for themselves (route is owner-tier)", async () => {
  const res = await api(cashier, "PUT", "/security/approval-pin", { pin: "999999" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("removing it again brings the count back to zero", async () => {
  await api(owner, "DELETE", "/security/approval-pin");
  const res = await api(owner, "GET", "/security/overview");
  eq(res.data.your_pin_is_set, false);
  eq(res.data.managers_who_can_approve, 0);
});

section("concurrency — the row-lock fix, as a formal regression test");
await t("racing two full-replace capability writes to the SAME cashier resolves cleanly (never a merge of both)", async () => {
  const setA = ["reports_accounting"];
  const setB = ["waste_tracking", "raw_materials"];
  let sawMerge = false;
  for (let i = 0; i < 8; i++) {
    await api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: [] }); // reset between attempts
    const [r1, r2] = await Promise.all([
      api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: setA }),
      api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: setB }),
    ]);
    const final = await api(owner, "GET", `/users/${cashierId}/capabilities`);
    const caps = (final.data.capabilities || []).slice().sort();
    const isA = JSON.stringify(caps) === JSON.stringify(setA.slice().sort());
    const isB = JSON.stringify(caps) === JSON.stringify(setB.slice().sort());
    if (!isA && !isB) { sawMerge = true; break; }
  }
  ok(!sawMerge, "8 concurrent-write attempts all merged the two writers' sets instead of one cleanly winning — the row lock isn't holding");
  await api(owner, "PUT", `/users/${cashierId}/capabilities`, { capabilities: [] }); // leave clean
});

await finish("t9-permissions.mjs");
