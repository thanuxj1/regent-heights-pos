# The drawer: starting cash and counting down

Everything else in this system records what it *thinks* happened — the sale, who
rang it, what was voided and by whose approval. Until 2026-09-09 nothing ever
counted the money. A cashier could be a thousand rupees short every evening and
no screen would notice, because nothing compared the drawer to the till.

## The shift

**Open** — the cashier counts what is already in the drawer and enters it as the
opening float. The header button reads **Open Drawer** and is highlighted amber
until they do; a cash sale rung up with no shift behind it cannot be counted at
the end of the day.

**During** — cash sales attach to the shift automatically. Money that moves for
any other reason is recorded as it happens:

| | |
|---|---|
| `pay_in` | money put in — topping up change |
| `pay_out` | money spent from the drawer — a bill, a repair, a supplier paid in cash |
| `drop` | money removed for safekeeping — a run to the safe |

Every movement needs a reason. *"Cash out 5,000"* with no reason is
indistinguishable from theft, and writing it down is the entire point.

A pay-out also says **what it was for**. A bill — electricity, a repair, food
bought for cash — is written to the owner's expenses in the same transaction and
marked *Paid from till* on the Accounting page, so the drawer and the books
agree. A supplier's invoice is the exception: it is recorded against its
purchase order on the Suppliers page, so it is not counted twice.

**Close** — the cashier counts the drawer and enters the total.

## The drawer PIN

Being signed in to the till is not enough to open the drawer. Every drawer
action — starting a shift, paying money in or out, counting up and closing —
also needs the property's **drawer PIN**, sent as the `X-Drawer-Pin` header.

- **Only the manager** sets it, changes it and can look it up, on the **Hotel
  Profile** page. They give it to the cashiers they trust and change it when
  someone leaves; the old PIN stops working at once.
- **No PIN set means no drawer.** Until the manager sets one the drawer stays
  locked. Sales still go through; they are just not in a shift.
- **Without the PIN the till learns only whether a drawer is open** — it needs
  that for its button — and never a figure.
- **Five wrong PINs** lock that person out of the drawer for 15 minutes, and the
  lock-out goes on the owner's activity log. A new PIN lifts it.
- The PIN is stored **encrypted, not hashed**, so the manager can be shown it. A
  four-digit hash would fall to 10,000 guesses anyway; without the server's key
  (`DRAWER_PIN_KEY`, or `JWT_SECRET` when that is not set) the stored value is
  useless. If the key changes, the saved PIN can no longer be read and the
  manager sets a new one.
- A PIN failure is 403, 423 or 429 — never 401, which the till treats as
  "signed out" and would answer by sending the cashier back to the login screen.

This is not the **manager's approval PIN**, which signs off a void, a large
discount or a drawer that does not balance.

## What should be in the drawer

```
  opening float
+ cash sales taken during the shift
+ money put in
− money paid out
− money dropped to the safe
= expected cash
```

Card and room-charge sales are deliberately absent: no note ever entered the
drawer for them, so counting them would make an honest cashier look short by the
value of every card sale they took. The till shows those separately, clearly
labelled *"not in the drawer"*, so nobody is surprised.

A **void lowers the expected figure** — the money went back to the customer.
That is also why a void needs a manager: it is the one action that reduces what
the drawer is measured against.

## The count comes before the answer

**The cashier types what they counted before they are shown what was expected.**

This is the one rule the close screen exists to enforce. Show the target first
and a count becomes a copy — and a drawer that always balances to the rupee
tells the owner nothing at all. The expected figure appears only in the result,
once the count is committed.

## Over, short, and who signs

`variance = counted − expected`. Negative is short, positive is over. **Both
matter** — a drawer that is always exactly right is itself worth a second look.

Past `CASH_VARIANCE_LIMIT` (default LKR 100), closing needs a manager's PIN —
the same PIN that authorises a void. A few rupees is rounding and honest error;
making a cashier fetch a manager over it just teaches them to adjust the count
to avoid the walk, which is the habit that hides real shortages.

Who approved it is stored on the session, along with the expected figure and any
note the cashier left. The expected figure is **frozen at close**, not
recomputed on read: a later refund must never quietly change what a closed shift
was measured against.

## What this required fixing first

**The tender was not recorded.** A sale's payment method was only saved if the
cashier happened to press "Pay" on the invoice screen afterwards — a separate,
optional step on another page. The `Payment` table was empty in practice. No
drawer can be reconciled without knowing which takings were notes, so the sale
now carries `payment_method` and its `session_id` from the moment it is created.

**Nor for a ticket sent to the kitchen first.** It is created before anyone
pays, and settling it later never recorded the tender — so a cash sale that went
through the kitchen was invisible to the drawer. Settling now records how it was
paid and attaches it to the drawer of the cashier who took the money.

## A bug this found on its first real sale

Ringing up a discounted item through the actual till failed with

> The total does not match the menu. Expected about 1000.00, got 900.00.

The menu prices a promotion with
`COALESCE(Branch_Product.discount_pct, Product.discount_pct, 0)` — and the
branch column is NULL for every real product here, so the discount lives on
`Product`. The server's price check read the branch column alone, so it quoted
full price and **refused every promoted sale at the counter.**

The test suites missed it entirely because they priced their test lines the same
wrong way — the tests and the code shared one mistaken assumption and agreed
with each other. Both are fixed, and `r14` now sells an item that is on offer
and refuses full price for it.

Worth remembering: a test that computes the expected value using the same helper
as the code under test is not checking arithmetic, it is checking that the code
agrees with itself.

## Where things live

- `Server/migrations/019_cash_sessions.sql` — `CASH_SESSION`, `CASH_MOVEMENT`,
  and `ORDER.payment_method` / `ORDER.session_id`
- `Server/utils/cashDrawer.js` — the arithmetic, in one place
- `Server/utils/drawerPin.js` — the drawer PIN: sealing, checking, lock-outs
- `Server/migrations/022_drawer_pin.sql` — one encrypted PIN per property
- `Client/src/components/branch-admin/DrawerPinCard.jsx` — the manager's PIN card
- `Server/controllers/cashSessionController.js`, `routes/cashRoutes.js`
- `Client/src/components/cashier/CashDrawerModal.jsx` — open, move, count
- `scratchpad/qa/r21-cash-drawer.cjs` — 29 checks over a full shift
