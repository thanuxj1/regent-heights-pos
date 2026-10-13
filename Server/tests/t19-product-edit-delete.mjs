// t19-product-edit-delete.mjs — editing a product has to reach the menu row the
// list and the till read; deleting a product takes it off every menu (as the
// delete page promises), and one that has already been sold is refused with a
// reason instead of "refers to a record that no longer exists".
import { ctx, api, t, eq, ok, status, section, finish, BASE } from "./lib.mjs";

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

section("menu photos are links, not data, in the list");
// A 1x1 PNG, standing in for a phone photo uploaded from the device.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let photoBpro, photoPro, link;
const photoRow = async () => (await api(owner, "GET", `/branch_products?B_id=${A.b_id}`)).data.find((x) => x.Bpro_id === photoBpro);

await t("a menu item with an uploaded photo is listed with a link to it, not the photo itself", async () => {
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Photo Dish", pro_qty: 5, pro_price: 300, cat_id: catId, com_id: A.com_id, pro_image: PNG });
  status(pro, 201);
  photoPro = pro.data.pro_id;
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: photoPro, pro_name: "ZZQA Photo Dish", pro_shortname: "Photo", pro_image: PNG,
    pro_des: "photo", cat_id: catId, pro_price: 300, pro_quantity: 5,
  });
  status(bp, 201);
  photoBpro = bp.data.Bpro_id;
  link = (await photoRow()).pro_image;
  ok(/^https?:\/\/.+\/api\/branch_products\/\d+\/image\?v=[0-9a-f]{12}$/.test(link), `expected a photo link, got ${String(link).slice(0, 60)}`);
});

await t("the link serves the photo as an image, without signing in, cacheable", async () => {
  const res = await fetch(link.replace(/^https?:\/\/[^/]+\/api/, BASE));
  eq(res.status, 200);
  eq(res.headers.get("content-type"), "image/png");
  ok(/max-age=31536000/.test(res.headers.get("cache-control") || ""), "a versioned link is cached");
  const bytes = Buffer.from(await res.arrayBuffer());
  eq(bytes.toString("base64"), PNG.split(",")[1]);
});

await t("a new photo gets a new link", async () => {
  status(await api(owner, "PUT", `/products/${photoPro}`, { pro_image: PNG2 }), 200);
  const next = (await photoRow()).pro_image;
  ok(next !== link, "the version in the link should change with the photo");
  link = next;
});

await t("sending a photo link back as the photo does not overwrite it", async () => {
  status(await api(owner, "PUT", `/branch_products/${photoBpro}`, { pro_image: link }), 200);
  eq((await photoRow()).pro_image, link, "the photo (and so its link) is unchanged");
});

section("product photos are links in the product list too");
let masterLink;
await t("the product list carries a link to the photo, which serves it without signing in", async () => {
  const list = await api(owner, "GET", "/products");
  status(list, 200);
  const row = (Array.isArray(list.data) ? list.data : list.data.data).find((x) => x.pro_id === photoPro);
  masterLink = row.pro_image;
  ok(/\/api\/products\/\d+\/image\?v=[0-9a-f]{12}$/.test(masterLink), `expected a product photo link, got ${String(masterLink).slice(0, 60)}`);
  const res = await fetch(masterLink.replace(/^https?:\/\/[^/]+\/api/, BASE));
  eq(res.status, 200);
  eq(res.headers.get("content-type"), "image/png");
  eq(Buffer.from(await res.arrayBuffer()).toString("base64"), PNG2.split(",")[1]);
  const one = await api(owner, "GET", `/products/${photoPro}`);
  eq(one.data.pro_image, PNG2, "the single product (the edit page) still has the photo itself");
});

await t("adding a product to the menu with that link uses the product's photo", async () => {
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Linked Photo", pro_qty: 5, pro_price: 300, cat_id: catId, com_id: A.com_id, pro_image: PNG });
  status(pro, 201);
  const list = await api(owner, "GET", "/products");
  const link2 = (Array.isArray(list.data) ? list.data : list.data.data).find((x) => x.pro_id === pro.data.pro_id).pro_image;
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Linked Photo", pro_shortname: "Linked", pro_image: link2,
    pro_des: "linked", cat_id: catId, pro_price: 300, pro_quantity: 5,
  });
  status(bp, 201, "a link to the product's photo is accepted");
  eq(bp.data.pro_image, "N/A", "no copy of the link is stored on the menu item");
  const row = (await api(owner, "GET", `/branch_products?B_id=${A.b_id}`)).data.find((x) => x.Bpro_id === bp.data.Bpro_id);
  ok(/\/api\/branch_products\/\d+\/image\?v=/.test(row.pro_image), "the menu shows the product's photo");
});

await finish("t19-product-edit-delete.mjs");
