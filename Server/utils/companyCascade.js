/**
 * Removing a company, and everything that was ever its.
 *
 * `DELETE FROM "Company"` on its own always failed: thirty-odd tables reference
 * a company's branches, its staff, its menu or its orders, so Postgres refused
 * with "it is referenced by existing records" and the Super Admin — the only
 * person allowed to remove a customer at all — could do nothing about it.
 *
 * So the whole tenant goes, in dependency order, inside one transaction: either
 * the company and all of it is gone, or nothing moved. The order below is taken
 * from the actual foreign keys in the database, children before parents.
 *
 * This is not recoverable. `companyImpact()` is what the screen shows first, so
 * the person pressing the button knows how many stays, tickets and staff go
 * with it — and can choose to deactivate instead, which keeps everything.
 */

/** The ids that belong to one company, gathered once and reused. */
async function scopeOf(client, comId) {
  const ids = async (sql, params) => (await client.query(sql, params)).rows.map((r) => Object.values(r)[0]);

  const branches = await ids('SELECT "B_id" FROM "Branch" WHERE com_id = $1', [comId]);
  const users = await ids(
    'SELECT u_id FROM "User" WHERE com_id = $1 OR "B_id" = ANY($2::int[])', [comId, branches]);
  const orders = await ids('SELECT or_id FROM "ORDER" WHERE b_id = ANY($1::int[])', [branches]);
  const bookings = await ids('SELECT booking_id FROM "BOOKING" WHERE b_id = ANY($1::int[])', [branches]);
  const folios = await ids(
    'SELECT folio_id FROM "FOLIO" WHERE booking_id = ANY($1::int[])', [bookings]);
  const sessions = await ids(
    'SELECT session_id FROM "CASH_SESSION" WHERE b_id = ANY($1::int[])', [branches]);
  const products = await ids('SELECT pro_id FROM "Product" WHERE "Com_id" = $1', [comId]);
  const bproducts = await ids(
    'SELECT "Bpro_id" FROM "Branch_Product" WHERE "B_id" = ANY($1::int[]) OR pro_id = ANY($2::int[])',
    [branches, products]);
  const rms = await ids(
    'SELECT rm_id FROM "Raw_Material" WHERE b_id = ANY($1::int[]) OR "Com_id" = $2', [branches, comId]);
  const suppliers = await ids('SELECT sup_id FROM "SUPPLIER" WHERE "Com_id" = $1', [comId]);
  const pos = await ids(
    'SELECT po_id FROM purchase_order WHERE b_id = ANY($1::int[]) OR sup_id = ANY($2::int[])',
    [branches, suppliers]);
  const agents = await ids(
    'SELECT agent_id FROM "COMMISSION_AGENT" WHERE b_id = ANY($1::int[])', [branches]);

  return { comId, branches, users, orders, bookings, folios, sessions,
           products, bproducts, rms, suppliers, pos, agents };
}

/**
 * Every delete, in the order the foreign keys demand. Each entry is
 * [table, WHERE clause, values] and runs exactly once.
 */
function plan(s) {
  const B = [s.branches], U = [s.users], O = [s.orders], BK = [s.bookings];
  return [
    ["COMMISSION_RECORD", "booking_id = ANY($1::int[]) OR agent_id = ANY($2::int[]) OR order_id = ANY($3::int[])",
      [s.bookings, s.agents, s.orders]],
    ["FOLIO_ITEM", "folio_id = ANY($1::int[]) OR ref_order_id = ANY($2::int[]) OR posted_by = ANY($3::int[])",
      [s.folios, s.orders, s.users]],
    ["Payment", "or_id = ANY($1::int[])", O],
    ["ORDER_ITEM", 'order_id = ANY($1::int[]) OR "Bpro_id" = ANY($2::int[])', [s.orders, s.bproducts]],
    ["STOCK_MOVEMENT",
      "b_id = ANY($1::int[]) OR rm_id = ANY($2::int[]) OR bpro_id = ANY($3::int[]) OR created_by = ANY($4::int[])",
      [s.branches, s.rms, s.bproducts, s.users]],
    ["discount", 'b_id = ANY($1::int[]) OR "Bpro_id" = ANY($2::int[])', [s.branches, s.bproducts]],
    ["ORDER",
      "b_id = ANY($1::int[]) OR folio_id = ANY($2::int[]) OR session_id = ANY($3::int[]) OR u_id = ANY($4::int[])",
      [s.branches, s.folios, s.sessions, s.users]],
    ["FOLIO", "booking_id = ANY($1::int[])", BK],
    ["BOOKING_PAYMENT", "booking_id = ANY($1::int[]) OR received_by = ANY($2::int[])", [s.bookings, s.users]],
    ["BOOKING_ROOM", "booking_id = ANY($1::int[])", BK],
    ["BOOKING",
      "b_id = ANY($1::int[]) OR agent_id = ANY($2::int[]) OR taken_by = ANY($3::int[])"
      + " OR checked_in_by = ANY($3::int[]) OR checked_out_by = ANY($3::int[])",
      [s.branches, s.agents, s.users]],
    ["GUEST", "b_id = ANY($1::int[])", B],
    ["TABLE_ASSIGNMENT", "u_id = ANY($1::int[])", U],
    ["TABLES", "branch_id = ANY($1::int[])", B],
    ["CASH_MOVEMENT", "session_id = ANY($1::int[]) OR created_by = ANY($2::int[])", [s.sessions, s.users]],
    ["CASH_SESSION",
      "b_id = ANY($1::int[]) OR opened_by = ANY($2::int[]) OR closed_by = ANY($2::int[]) OR approved_by = ANY($2::int[])",
      [s.branches, s.users]],
    ["purchase_item", "po_id = ANY($1::int[]) OR rm_id = ANY($2::int[])", [s.pos, s.rms]],
    ["supplier_payment", "po_id = ANY($1::int[]) OR sup_id = ANY($2::int[])", [s.pos, s.suppliers]],
    ["purchase_order", "b_id = ANY($1::int[]) OR sup_id = ANY($2::int[])", [s.branches, s.suppliers]],
    ["SUPPLIER", '"Com_id" = $1', [s.comId]],
    ["RECIPE", 'pro_id = ANY($1::int[]) OR "rawmaterial_ID" = ANY($2::int[])', [s.products, s.rms]],
    ["Branch_Product", '"Bpro_id" = ANY($1::int[])', [s.bproducts]],
    ["Product", '"Com_id" = $1', [s.comId]],
    ["Raw_Material", 'b_id = ANY($1::int[]) OR "Com_id" = $2', [s.branches, s.comId]],
    ["EXPENSE", "b_id = ANY($1::int[]) OR created_by = ANY($2::int[])", [s.branches, s.users]],
    ["DRAWER_PIN", "b_id = ANY($1::int[]) OR updated_by = ANY($2::int[])", [s.branches, s.users]],
    ["ROOM", "b_id = ANY($1::int[])", B],
    ["ROOM_TYPE", "b_id = ANY($1::int[])", B],
    ["MEAL_PLAN", "b_id = ANY($1::int[])", B],
    ["HOTEL_POLICY", "b_id = ANY($1::int[])", B],
    ["COMMISSION_AGENT", "b_id = ANY($1::int[])", B],
    ["LOGIN_LOCATION", "b_id = ANY($1::int[]) OR created_by = ANY($2::int[])", [s.branches, s.users]],
    ["ACTIVITY_LOG", "b_id = ANY($1::int[]) OR u_id = ANY($2::int[])", [s.branches, s.users]],
    ["User", "u_id = ANY($1::int[])", U],
    ["category", "com_id = $1", [s.comId]],
    ["Branch", "com_id = $1", [s.comId]],
    ["Company", "com_id = $1", [s.comId]],
  ];
}

/** What the screen shows before anyone presses Delete. */
export async function companyImpact(client, comId) {
  const s = await scopeOf(client, comId);
  const count = async (table, where, params) => {
    const { rows } = await client.query(`SELECT COUNT(*)::int n FROM "${table}" WHERE ${where}`, params);
    return rows[0].n;
  };
  return {
    properties: s.branches.length,
    staff: s.users.length,
    menu_items: s.bproducts.length,
    products: s.products.length,
    ingredients: s.rms.length,
    suppliers: s.suppliers.length,
    rooms: await count("ROOM", "b_id = ANY($1::int[])", [s.branches]),
    stays: s.bookings.length,
    tickets: s.orders.length,
    payments: await count("Payment", "or_id = ANY($1::int[])", [s.orders]),
    purchase_orders: s.pos.length,
    audit_entries: await count("ACTIVITY_LOG", "b_id = ANY($1::int[]) OR u_id = ANY($2::int[])",
      [s.branches, s.users]),
  };
}

/** Remove the company and everything under it. Caller owns the transaction. */
export async function deleteCompanyCascade(client, comId) {
  const s = await scopeOf(client, comId);
  const removed = {};
  for (const [table, where, params] of plan(s)) {
    const r = await client.query(`DELETE FROM "${table}" WHERE ${where}`, params);
    if (r.rowCount) removed[table] = r.rowCount;
  }
  return removed;
}
