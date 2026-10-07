# Delivery charge

A flat charge on a delivery order: **None, 50, 100, 150 or 200** (LKR).

## At the till
- Choosing **Delivery** shows a "Delivery Charge" picker. The cashier must pick one
  (**None** counts as a choice) before *Send to Kitchen* or *Checkout* will go through.
- The charge is added **after tax**: `total = (food − discount + service fee) × (1 + tax) + charge`.
- It is printed on the bill / invoice as its own "Delivery Charge" line.
- Switching away from Delivery clears the charge.

## On the server
- Stored in `"ORDER".delivery_charge` (migration `049_delivery_charge.sql`).
- `Server/utils/deliveryCharge.js` is the single source of the allowed amounts
  (the till's copy is `Client/src/constants/deliveryCharges.js` — keep both in step).
- Any amount outside the list is refused, and only a delivery order may carry one.
- `or_totalCostWtax` must include the charge; the order is refused if it doesn't add up.

## In the reports
- The charge is **inside** `or_totalCostWtax`, so every existing total (drawer, restaurant
  revenue, P&L, COD settlements) already includes it. Nothing is added twice.
- `/reports/summary` also returns `revenue.delivery_charges` — the portion of restaurant
  revenue that was delivery charges. `revenue.total` is unchanged.
- `/reports/transactions` rows carry `delivery_charge`; the ledger shows "incl. … delivery",
  and the CSV exports gain an "Of which delivery charge" column.
- A COD order's charge counts when the order is settled, like the rest of its total.

## Changing the amounts
Edit both lists above, and the error text in `deliveryCharge.js`. Existing orders keep
whatever they were charged.
