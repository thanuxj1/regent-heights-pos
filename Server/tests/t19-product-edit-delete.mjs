// t19-product-edit-delete.mjs — editing a product has to reach the menu row the
// list and the till read; deleting a product takes it off every menu (as the
// delete page promises), and one that has already been sold is refused with a
// reason instead of "refers to a record that no longer exists".
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;

let catId, otherCatId, proId, bproId;
const menuRow = async () => {
  const r = await api(owner, "GET", `/branch_products?B_id=${A.b_id}`);
  status(r, 200);
  return r.data.find((x) => x.Bpro_id === bproId);
};

section("setup");
await t("owner creates two categories, a product, and puts it on the menu", async () => {
  const c1 = await api(owner, "POST", "/categories", { cat_name: `${stamp}_EditA` });
  const c2 = await api(owner, "POST", "/categories", { cat_name: `${stamp}_EditB` });
  status(c1, 201); status(c2, 201);
  catId = c1.data.cat_id; otherCatId = c2.data.cat_id;
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Edit Me", pro_qty: 10, pro_price: 300, cat_id: catId, com_id: A.com_id });
  status(pro, 201);
  proId = pro.data.pro_id;
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: proId, pro_name: "ZZQA Edit Me", pro_shortname: "Edit", pro_image: "placeholder.png",
    pro_des: "before", cat_id: catId, pro_price: 300, pro_quantity: 10,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
});

section("the menu row the list reads");
await t("editing the product updates the menu row's name, category, picture and description, not its price", async () => {
  const put = await api(owner, "PUT", `/products/${proId}`, {
    pro_name: "ZZQA Edited Name", cat_id: otherCatId, pro_image: "edited.png", description: "after", pro_price: 999,
  });
  status(put, 200);
  const row = await menuRow();
  eq(row.pro_name, "ZZQA Edited Name");
  eq(Number(row.cat_id ?? row.Cat_id), Number(otherCatId));
  eq(row.pro_image, "edited.png");
  eq(row.pro_des, "after");
  eq(Number(row.pro_price), 300, "price is per branch and changes only through the branch's own row");
});

await t("an empty picture or description on the product does not wipe the menu's", async () => {
  status(await api(owner, "PUT", `/products/${proId}`, { pro_image: "", description: "" }), 200);
  const row = await menuRow();
  eq(row.pro_image, "edited.png");
  eq(row.pro_des, "after");
});

section("deleting a product");
await t("deleting a product that is on a menu takes it off the menu and deletes it", async () => {
  status(await api(owner, "DELETE", `/products/${proId}`), 204);
  eq(await menuRow(), undefined, "the menu row should be gone with the product");
  status(await api(owner, "GET", `/products/${proId}`), 404);
});

await t("deleting a product that does not exist is a 404", async () => {
  status(await api(owner, "DELETE", `/products/${proId}`), 404);
});

await t("a product that has already been sold is refused with a reason, and nothing is removed", async () => {
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Sold Item", pro_qty: 10, pro_price: 300, cat_id: catId, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Sold Item", pro_shortname: "Sold", pro_image: "placeholder.png",
    pro_des: "sold", cat_id: catId, pro_price: 300, pro_quantity: 10,
  });
  status(bp, 201);
  const sale = await api(A.cashier.token, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 300, or_totalCostWtax: 300, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-t19-sale`, payment_method: "cash",
    },
    items: [{ Bpro_id: bp.data.Bpro_id, pro_quantity: 1, unit_price: 300 }],
  });
  status(sale, 201);

  const del = await api(owner, "DELETE", `/products/${pro.data.pro_id}`);
  status(del, 409);
  ok(/already been sold/i.test(del.data.message), `message should say why, got: ${del.data.message}`);
  ok(!/no longer exists/i.test(del.data.message), "must not be the generic foreign-key text");
  status(await api(owner, "GET", `/products/${pro.data.pro_id}`), 200, "the product must still be there");
  const row = (await api(owner, "GET", `/branch_products?B_id=${A.b_id}`)).data.find((x) => x.Bpro_id === bp.data.Bpro_id);
  ok(row, "its menu row must still be there too (the delete is all or nothing)");
});

await finish("t19-product-edit-delete.mjs");
