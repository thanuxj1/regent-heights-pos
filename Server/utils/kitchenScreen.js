// utils/kitchenScreen.js
//
// Not every property works its orders on a kitchen screen. Regent Heights'
// kitchen cooks from the printed KOT and nobody in it ever touches the
// terminal, so an order there never moves past "pending" on its own: every
// paid sale sat on the Kitchen Orders page as Pending for good, and any screen
// that waited for "completed" missed most of the day's takings.
//
// Branch.kitchen_screen says which kind of property this is. Where it is off,
// an order that is paid for (or on a guest's bill) is finished the moment it
// is rung up; only an open, unpaid bill stays pending, until it is settled.

/** Does this property move its orders along on a kitchen screen? */
export async function hasKitchenScreen(db, b_id) {
  const { rows } = await db.query(
    `SELECT kitchen_screen FROM "Branch" WHERE "B_id" = $1`, [b_id]);
  return rows[0]?.kitchen_screen ?? true;
}
