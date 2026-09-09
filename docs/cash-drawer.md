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
| `pay_out` | money spent from the drawer — a supplier paid in cash |
| `drop` | money removed for safekeeping — a run to the safe |

Every movement needs a reason. *"Cash out 5,000"* with no reason is
indistinguishable from theft, and writing it down is the entire point.

**Close** — the cashier counts the drawer and enters the total.

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
- `Server/controllers/cashSessionController.js`, `routes/cashRoutes.js`
- `Client/src/components/cashier/CashDrawerModal.jsx` — open, move, count
- `scratchpad/qa/r21-cash-drawer.cjs` — 29 checks over a full shift
