# Stock: taken when a dish is sold

Until 2026-09-15 a recipe's ingredients were deducted when the owner
"prepared" portions on the menu page, and a sale only lowered the portion
count. That suits a bakery. This kitchen cooks kottu and chicken rice to order,
so ingredients now leave stock **at the moment of sale**.

## Three kinds of menu item

| | stock that moves on a sale | "N left" on the till |
|---|---|---|
| **Recipe dish** — has lines in the Recipe Mapper | its ingredients (`Raw_Material`), converted into the unit each is stocked in | the portions its scarcest ingredient allows |
| **Counted item** — no recipe, counted (a bottle of water, a tray of pastries) | its own count (`Branch_Product.pro_quantity`) | that count |
| **Made to order** — no recipe, `Product.track_inventory = false` | nothing | "Made to order" — no number, and never sold out |

The third one exists because the first two could not answer an ordinary
question. Twenty pastries come out of the oven, go on the rack, and sell down
to none: that is a count. Kottu is cooked when somebody asks for it. Nobody can
say in the morning how many the property *has*, and the only number the day
produces is how many were made, which is known when the day is over.

Asked for a quantity anyway, an owner types 0 — and the till then shows the
dish in amber, "0 in stock", all service — or types 999, after which no count
on the menu means anything. So a dish cooked to order is now stocked in the
third way: nothing is counted, nothing is deducted, and it never runs out.
`track_inventory` had been sitting on `Product` with a toggle on the product
form since before any of this, read by nothing. It is now the switch between
counted and made to order, and the form says so in those words rather than
"track inventory".

A recipe wins over both: a dish with ingredients is stocked by its ingredients,
whatever the toggle says. That is the case where the kitchen genuinely can run
out — of flour, not of kottu.

`GET /api/branch_products` returns `stock_mode`, `available` and `limited_by`
alongside the stored `pro_quantity`, plus `made_today` — how many of that item
have been sold today, which for a made-to-order dish is the only figure it has.
`available` comes back **null** for those, and every screen reads that as
"always on the menu" (`Client/src/utils/stockLabel.js`, asked by the till, the
waiter's pad, the room rack and the product list so they cannot disagree).

The menu page refuses a typed count for a recipe dish, because a number there
would mean nothing: its stock is its ingredients. It refuses one for a
made-to-order dish too, and says where to change its kind if the kitchen has
started making it in batches.

### What every product screen had to learn

Adding the third kind meant going back through each way a product is created,
read, changed and removed, because several of them quietly assumed a count:

* **Putting an existing dish on a property's menu** moves an opening quantity
  down from the main hotel's count, and refused anything the main count could
  not cover. A made-to-order dish holds no stock anywhere, so its main count is
  zero and adding it was refused — *"Insufficient stock in main hotel: only 0
  available"* — a figure that should never have been consulted. Nothing is
  moved for one now, and the menu row is stored holding nothing.
* **The product forms** no longer ask for a quantity they cannot use: the
  create form asks *how* it is stocked before asking *how many*, the edit form
  fades its count fields out, and neither stores a leftover figure when the
  answer is "made to order".
* **"Low stock"** is the item's own `low_stock` — the *Low stock alert* on the
  product page. The screens used to decide it themselves, the list calling ten
  low and the till calling five low, so that field on the form changed nothing
  at all. A dish made to order is never low: there was never a count to run
  down.
* **`tax_group`** was in the same state. The till works out tax per line from
  `product.tax_group`, the menu never sent it, so every line silently fell back
  to 5%. It is sent now.
* **A yes/no sent as a word.** `Boolean("false")` is true, so a client sending
  the word rather than the value would have turned a made-to-order dish back
  into a counted one — and it would have looked like the toggle refusing to
  stay off.

Every path that sells now takes stock the same way: the till, a kitchen
ticket, waiter lines, edits to an open ticket, and room service. Room
service never reduced stock at all before this change.

A sale of a made-to-order dish writes no stock movement, so voiding one puts
nothing back — there is nothing to put back, and the ledger says so rather than
inventing a return.

## Nothing is refused for stock

Counts drift — a delivery not yet entered, a sack miscounted — and a kitchen
that has the food must be able to sell it. So a sale the count cannot cover
**goes through**, online or offline. The count goes below zero, the till shows
the item in amber as "0 in stock" (still sellable), and the activity log says:

> Sold beyond the stock count on order #… — flour now -2 kg. Worth a recount.

Negative is the honest figure: it tells the manager to count. Clamping at zero,
as the old code did, hid it.

## Correcting the count

Only a manager (the Administrator) changes a stock figure by hand, and every
change says why:

- **Inventory → Count** on an ingredient, or **Count** beside a counted item on
  the menu page: enter what is actually on the shelf and a reason. It sets the
  figure, writes an `adjust` line to `STOCK_MOVEMENT` with who and why, and
  puts it in the activity log.
- The Edit dialog no longer changes the stock figure. It used to overwrite it
  with no record at all.
- The **+/− stepper** beside each counted item on the menu page is gone. A
  click on it wrote the new figure straight to the row through
  `PUT /api/branch_products/:id` — no reason asked, no `adjust` line, nothing
  in the activity log — so the ledger drifted from the count and nobody could
  see who had moved it, or why. That endpoint now refuses a `pro_quantity`
  different from the one stored, exactly as the ingredient edit form already
  did, and Count is the only way. (The **company** product list keeps its
  stepper: it moves `Product.pro_qty`, which is not on this ledger.)
- Kitchen staff keep their existing "add / take out" adjustment, but it is now
  on the ledger with a reason, and may go below zero like everything else.
- A count is never negative — nobody counts minus three sacks — and a recipe
  dish has no count of its own: count its ingredients.
- Counting a counted item sets the shelf figure and moves nothing from main
  stock; a correction is not a transfer.

## A void returns exactly what was taken

`STOCK_MOVEMENT` records what every order line took. A void, cancel, delete, or
a line edited or removed on an open ticket replays that record in reverse:

- **exactly** what that sale took — even if the recipe has changed since;
- **at most once** — a unique index on `reverses` makes a second return
  impossible, whichever path tries.

The old code subtracted with `GREATEST(0, stock − qty)`. A sale of something
already at zero vanished from the count, and voiding that sale then *added* a
portion that had never existed. Both are tested in `r22`.

Orders taken before migration 020 have no ledger rows, so voiding one returns
nothing. That is the safe direction.

## Buying

**Add Inventory Item** creates a pending purchase order. New items are created
**empty**. Stock arrives once, when the order is marked received on the
**Suppliers** page. The form used to create each new item holding the bought
quantity, and receiving then added it again, so every new item was counted twice.

Receiving can carry a payment in the same request, or the goods can be taken
on credit and paid later, in parts. The server refuses a payment above the
balance, and any payment before the goods have arrived. A supplier needs a
name and a phone number; email is optional.

## Money out

- **Supplier payments** are owner-only and scoped to the property. They had no
  login check at all: anyone who could reach the server could list every
  company's payments, with supplier names and phone numbers, and add or delete
  them.
- **Expenses** are owner-only. A waiter could delete the owner's bills.
- The **Accounting** totals work. They crashed on an undeclared variable, and
  because the page loaded the list and the totals together, a saved bill looked
  lost.
- A **pay-out from the till** asks what it was for. A bill becomes an expense in
  the same transaction, marked *Paid from till*. "A supplier's invoice" does
  not, because that is recorded against its purchase order and would otherwise
  be counted twice.
- **Money out** = expenses + supplier payments, in Accounting and in the profit
  on the Reports page.

## Settling does not rewrite the sale

A ticket that has already gone to the kitchen is settled by recording how it was
paid — not by rebuilding it. The till used to mark the order completed and then
delete every line and write them all back, which meant:

- three entries on the stock ledger for every line of every sale — taken, put
  back, taken again — on a sale nobody had changed;
- a moment mid-settle when the count read high, the stock having gone back and
  not yet been taken again;
- and a server that had to allow a **paid** order's lines to be edited. The
  cashier was exempted from the guard by name, so items could be lifted off a
  settled sale afterwards: their stock came back while the total stood still.

The till now compares the cart with the order's lines and touches only what
actually changed, while the ticket is still the kitchen's. The order is marked
completed last, and `guardOrderStatus` refuses line changes on a completed or
cancelled order — for everyone. Round 26 holds it down: settling leaves exactly
one `sale` entry per line, and deleting a line from a paid sale is refused with
the stock unmoved.

## Two tills at once

Selling locks the stock rows the sale will touch, always in the same order, so
two tills drawing on the same flour queue behind each other instead of
interleaving. The lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`, and the word
matters: a sale writes its lines first, and an `ORDER_ITEM` row holds a KEY
SHARE lock on the `Branch_Product` row it points at. Asking to upgrade that
share to `FOR UPDATE` while another till holds the same share is a deadlock, and
Postgres settles a deadlock by killing one of the transactions — which here
means losing a sale. A 45-second run with a dozen staff working at once lost 32
sales that way, all with a 500, while every figure that did survive was correct.
`FOR NO KEY UPDATE` does not conflict with KEY SHARE, and nothing a stock update
does touches a key.

`scratchpad/qa/r27-load.cjs` is the run that found it: it works the property
hard for a while, then audits what is left — every ticket against its own lines,
stock against its ledger, a sale sent twice, and no lines orphaned.

## Where things live

- `Server/migrations/020_stock_at_sale.sql` — the ledger, optional supplier
  email, pay-out categories
- `Server/migrations/021_stock_counts.sql` — the `adjust` reason, which must carry a note
- `Server/migrations/024_made_to_order.sql` — the third kind of menu item, and
  the product columns that were never written into a migration
- `Client/src/utils/stockLabel.js` — what a tile says about stock, asked by
  every screen that shows one
- `Client/src/components/branch-admin/CountStockModal.jsx` — the manager's count
- `Server/utils/inventory.js` — `takeStock`, `returnStock`, `availabilityFor`,
  `convertQty`
- `Server/controllers/orderController.js`, `orderItemController.js`,
  `waiterController.js`, `frontDeskController.js` — every sale and reversal
- `Server/controllers/branchProductController.js` — the shelf count: `countBranchProduct`
  records it, and the edit path refuses to move it
- `Server/controllers/purchaseOrderController.js` — receiving, with an optional payment
- `Server/controllers/supplierPaymentController.js` — scoped payments
- `Client/src/pages/branch-admin/SupplierManagement.jsx` — receive, pay later, balances
- `scratchpad/qa/r22-stock-and-money.cjs` — the checks behind every claim above
- `scratchpad/qa/r28-stock-modes.cjs` — the three kinds, sold, oversold, counted,
  voided and switched from one to the other
