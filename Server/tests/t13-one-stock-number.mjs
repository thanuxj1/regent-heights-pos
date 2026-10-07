// t13-one-stock-number.mjs — goods bought for a counted product that is already on
// the branch's menu go straight onto the shelf (what the till sells from); a
// product not on the menu yet still waits in the storeroom.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;

let catId, supId, onMenu, notOnMenu;

const receive = async (proId, qty) => {
  const po = await api(owner, "POST", "/purchase-orders", { sup_id: supId, B_id: A.b_id });
  status(po, 201);
  const poId = po.data.po_id ?? po.data.data?.po_id;
  status(await api(owner, "POST", "/purchase-items", { po_id: poId, pro_id: proId, qty, price: qty * 10, unit_price: 10 }), 201);
  status(await api(owner, "PATCH", `/purchase-orders/${poId}/status`, { status: "received" }), 200);
  return poId;
};
const shelf = async (bproId) => {
  const res = await api(owner, "GET", `/branch_products?b_id=${A.b_id}`);
  status(res, 200);
  const row = (res.data.data ?? res.data).find((x) => x.Bpro_id === bproId);
  return Number(row.pro_quantity);
};
const storeroom = async (proId) => Number((await api(owner, "GET", `/products/${proId}`)).data.pro_qty);

section("setup");
await t("a supplier and two counted products, one on the menu and one not", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_StockMenu` });
  status(cat, 201);
  catId = cat.data.cat_id;
  const sup = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Drinks Co` });
  status(sup, 201);
  supId = sup.data.sup_id;

  const p1 = await api(owner, "POST", "/products", { pro_name: "ZZQA Water", pro_qty: 0, pro_price: 100, cat_id: catId, com_id: A.com_id });
  status(p1, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: p1.data.pro_id, pro_name: "ZZQA Water", pro_shortname: "Water",
    pro_image: "placeholder.png", pro_des: "t", cat_id: catId, pro_price: 100, pro_quantity: 0,
  });
  status(bp, 201);
  onMenu = { pro_id: p1.data.pro_id, bpro_id: bp.data.Bpro_id };

  const p2 = await api(owner, "POST", "/products", { pro_name: "ZZQA Juice", pro_qty: 0, pro_price: 100, cat_id: catId, com_id: A.com_id });
  status(p2, 201);
  notOnMenu = { pro_id: p2.data.pro_id };
});

section("receiving a purchase");
await t("a product on the menu: received stock lands on the shelf, not the storeroom", async () => {
  const poId = await receive(onMenu.pro_id, 12);
  eq(await shelf(onMenu.bpro_id), 12, "on the shelf");
  eq(await storeroom(onMenu.pro_id), 0, "nothing left waiting in the storeroom");
  const mv = await pool.query(`SELECT qty, reason FROM "STOCK_MOVEMENT" WHERE bpro_id = $1 AND po_id = $2`, [onMenu.bpro_id, poId]);
  eq(mv.rows.length, 1, "one stock movement recorded");
  eq(Number(mv.rows[0].qty), 12, "movement qty");
  eq(mv.rows[0].reason, "purchase", "movement reason");
});

await t("receiving again adds to the same shelf count", async () => {
  await receive(onMenu.pro_id, 8);
  eq(await shelf(onMenu.bpro_id), 20, "12 + 8 on the shelf");
});

await t("a product not on the menu yet waits in the storeroom", async () => {
  await receive(notOnMenu.pro_id, 5);
  eq(await storeroom(notOnMenu.pro_id), 5, "held until the product is put on the menu");
});

await finish("t13-one-stock-number.mjs");
