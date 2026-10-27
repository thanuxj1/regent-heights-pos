// utils/expenseCategories.js
//
// Which categories an expense may be filed under at a property, and whose
// cost each one is. Nine are built in; a property adds its own on the
// Accounting page (EXPENSE_CATEGORY, migration 071). An expense stores the
// built-in key ("raw_materials") or the property's own name as written ("Gas").

export const BUILTIN_CATEGORIES = [
  "utilities", "salary", "raw_materials", "commission",
  "maintenance", "marketing", "delivery", "food_packets", "other",
];
const BUILTIN_LABELS = {
  utilities: "Utilities", salary: "Salary", raw_materials: "Raw Materials", commission: "Commission",
  maintenance: "Maintenance", marketing: "Marketing", delivery: "Delivery", food_packets: "Food Packets", other: "Other",
};
// Whose cost a built-in category is, for the hotel / restaurant split in Reports.
// Anything not listed is the whole property's.
const BUILTIN_DEPARTMENT = { commission: "hotel", raw_materials: "restaurant", food_packets: "restaurant", delivery: "restaurant" };

export const EXPENSE_METHODS = ["cash", "card", "bank_transfer", "cheque", "online"];

/** A name a property's own category may not take: a built-in one, by key or by label. */
export const isBuiltinName = (name) => {
  const n = String(name || "").trim().toLowerCase();
  return BUILTIN_CATEGORIES.some((k) => k === n || k.replace(/_/g, " ") === n || BUILTIN_LABELS[k].toLowerCase() === n);
};

/** The property's own categories. */
export async function customCategories(db, b_id) {
  if (!b_id) return [];
  const { rows } = await db.query(
    `SELECT cat_id, name, department FROM "EXPENSE_CATEGORY" WHERE b_id = $1 ORDER BY lower(name)`, [b_id]);
  return rows;
}

/**
 * What to store for a category chosen at this property: the built-in key, or
 * the property's own name exactly as it was created. Null if it is neither.
 */
export async function resolveCategory(db, b_id, value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (BUILTIN_CATEGORIES.includes(v)) return v;
  const own = (await customCategories(db, b_id)).find((c) => c.name.toLowerCase() === v.toLowerCase());
  return own ? own.name : null;
}

/** { hotel: [...], restaurant: [...] } — categories whose costs belong to one side. */
export async function departmentCategories(db, b_id) {
  const out = { hotel: [], restaurant: [] };
  for (const [k, d] of Object.entries(BUILTIN_DEPARTMENT)) out[d].push(k);
  for (const c of await customCategories(db, b_id)) if (out[c.department]) out[c.department].push(c.name);
  return out;
}
