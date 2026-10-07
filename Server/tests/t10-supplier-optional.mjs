// t10-supplier-optional.mjs — only a supplier's name is required.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;

section("supplier with only a name");
let firstId;
await t("a supplier can be saved with just a name", async () => {
  const res = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Name Only` });
  status(res, 201);
  firstId = res.data.sup_id;
  ok(res.data.sup_contact == null, "contact should be empty");
});

await t("a second supplier with no contact is fine (no duplicate-contact clash on blanks)", async () => {
  const res = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Name Only Two`, sup_contact: "   " });
  status(res, 201);
});

await t("a name is still required", async () => {
  const res = await api(owner, "POST", "/suppliers", { sup_contact: "0771234567" });
  status(res, 400);
});

await t("a contact that is given must still be a valid number", async () => {
  const res = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Bad Phone`, sup_contact: "abc" });
  status(res, 400);
});

await t("a real contact is still saved and still checked for duplicates", async () => {
  const a = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} With Phone`, sup_contact: "0772295234" });
  status(a, 201);
  eq(a.data.sup_contact, "0772295234", "contact saved");
  const b = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Same Phone`, sup_contact: "0772295234" });
  status(b, 409);
});

await t("the contact can be added later to a supplier saved without one", async () => {
  const res = await api(owner, "PUT", `/suppliers/${firstId}`, { sup_contact: "0719876543" });
  status(res, 200);
  eq(res.data.sup_contact, "0719876543", "contact added");
});

await finish("t10-supplier-optional.mjs");
