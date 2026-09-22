# Security notes

What is enforced, where it lives, and the decisions behind it. Written for
whoever picks this up next — including me in six months.

---

## 1. Before you deploy

Four things that are fine locally and break, quietly, in production.

### `TRUST_PROXY` — set it, or the rate limiter does nothing

Behind nginx / Render / Cloudflare, the socket address is the **proxy's**, so
every guest in the hotel looks like one client and one attacker looks like all
of them. Set it to the number of proxy hops:

```bash
TRUST_PROXY=1
```

Never set it to `true`. That trusts any `X-Forwarded-For` header, and anyone can
forge one and walk straight past the limiter. `Server/server.js` leaves it unset
by default for exactly this reason.

### `CLIENT_URL` — CORS defaults to `*`

`Server/server.js` falls back to `origin: "*"` with `credentials: true`. Set
`CLIENT_URL` to the real front-end origin.

### `JWT_SECRET` — must be long and must not be the dev one

There is no fallback: the server returns 500 rather than sign with a default.

`.env` is loaded **relative to `Server/`, not the working directory**
(`server.js` and `config/database.js` resolve it from `import.meta.url`).
Launching the server by absolute path from another folder previously left
`JWT_SECRET` and `DATABASE_URL` unset, and every authenticated request answered
500 with the cause visible only in the server console. Keep it path-explicit.

### Tokens live 7 days (`JWT_EXPIRE`)

Long for a shared front-desk terminal. Deactivating an account takes effect in
**30 seconds** regardless (see §3), so a stolen token is not indefinite — but
shorten this if terminals are shared with guests.

---

## 2. The database: where it lives and how it is pooled

Moved to **AWS ap-southeast-1 (Singapore)** on 2026-09-06. The old Ohio project
is still there, untouched, holding the same data; `Server/.env` keeps its
connection string as `OLD_DATABASE_URL_OHIO`. To roll back, put that value in
`DATABASE_URL` and restart. Nothing else to undo.

`scripts/migrate-region.cjs` did the copy and `scripts/verify-region.cjs`
checked it — content compared row by row, not by counting, because matching
counts nearly hid the tenant leak in section 3.

### Three settings that matter more than the region did

Measured on a page of the POS, which fires five requests at once:

| | median per call |
|---|---|
| before | 9,239 ms |
| after | ~110 ms |

Only part of that was the move. The rest:

**`idleTimeoutMillis: 30_000` — do not set this to 0.** Holding connections open
forever looks like the obvious win and is a trap: Neon closes an idle pooled
connection from its side, the error arrives on a client nobody is listening to,
and Node treats an unhandled `'error'` event as fatal. It took the whole server
down mid-test. Thirty seconds is inside any server-side timeout, so the close is
always ours to make.

**Every client gets an error listener**, attached on the pool's `connect` event.
`pool.on("error")` only covers clients sitting idle *in* the pool; one checked
out inside a transaction emits on itself. That gap is what actually crashed it.

**`maxAge: 7200` on CORS.** Without it the browser sends an `OPTIONS` preflight
before every single call and never remembers the answer — two round trips for
every one request. This was a bigger share of the felt slowness than the region.

`warmPool()` opens five connections at boot so the first cashier of the day does
not pay for opening them. A warm request is ~110ms; five arriving on a cold pool
took 918ms.


### Checked after the move, not assumed

`scratchpad/qa/r16-db-integrity.cjs` does not count constraints — it tries to
write bad data and expects to be refused, every check rolled back. All 37 tables
have a primary key; foreign keys, unique indexes and check constraints all bite;
no row points at a parent that is gone; every id sequence is past its table's
highest value. Singapore and Ohio were probed side by side and behaved
identically, which is what proves the copy lost nothing.

Two things it turned up:

**`_migrations` was three entries short.** Migrations 016 and 017 were applied
by hand during the session and never recorded, so a future run of
`scripts/migrate.js` would have tried them again. Recorded now, along with 018.

**Ten columns naming an owner (`b_id`, `B_id`, `com_id`) allow NULL.** Only
`"ORDER".b_id` was tightened (migration `018`): a sale with no property is money
that belongs to nobody, invisible to every branch-scoped query while still
sitting in the table. The others were left alone deliberately — `"User".B_id`
and `com_id` being NULL is *how Super Admin is represented*, and an
`ACTIVITY_LOG` row can predate knowing the branch. Making those NOT NULL would
break the design rather than harden it.

---

## 3. Tenant isolation — `Server/utils/scope.js`

**Rule: the branch comes from the token, never from the query string or body.**

This was a real leak, not a theoretical one. Hotel endpoints read `b_id` from the
query and filtered on *nothing* when it was absent, so one hotel could read
another's bookings and guests. It nearly went unnoticed because the first test
compared row **counts**, which matched; comparing **content** showed 27 shared
rows. Fixed across 51 endpoints.

| Helper | Use it for |
|---|---|
| `branchScope(req)` | the caller's scope: `all` / `company` / `one` |
| `branchClause(req, column, params)` | the `WHERE` fragment for a read |
| `writeBranchId(req)` | the `b_id` to store on a write |
| `assertInScope(req, res, {...})` | before touching a row by id |

Two things to preserve:

- `assertInScope` throws **404, not 403** — a 403 confirms the row exists, which
  tells a stranger something about another tenant.
- The default is **fail closed**: no branch on the token yields `b_id = -1`, which
  matches nothing. Do not "helpfully" make it match everything.

When adding an endpoint, ask: *if I hand this a token from another company, does
it return their rows?* `/api/orders` was missed in the first sweep and was found
later returning 7 orders across two companies.

### Live updates are scoped the same way

The same question has to be asked of every socket event, and the answer used to
be wrong. Kitchen screens all sat in one room called `kitchen-updates` — one
room for the whole platform — so every hotel's kitchen was sent every other
hotel's orders, whole rows at a time. Adding a dish to a ticket went further
still: it was emitted with no room at all, which is every screen connected to
the server.

Rooms are per property now (`Server/utils/socket.js`):

| Room | Who is in it |
|---|---|
| `branch:<b_id>` | that property's staff — floor, till, kitchen, managers |
| `kitchen:<b_id>` | that property's kitchen screens |
| `company:<com_id>` | a company-level admin |
| `cashier-updates:<u_id>` | one person, for "your order is ready" |
| `branch-updates` | platform staff only (Super Admin) |

`branch-updates` carries every property's records, so hotel administrators are
no longer seated in it — they were being sent other companies' properties as
those were created and edited.

Round 24 (`r24-kitchen-board`) holds this down: it connects a second company's
kitchen and manager as sockets and fails if either hears one event about ours.

---

## 4. Who can do what

`ROLES` in `Server/middleware/authMiddleware.js`:

| id | Role | Notes |
|---|---|---|
| 6 | Super Admin | the developer / platform, not the client |
| 2 | Admin | **retired** (migration 007). Nobody holds it; the API refuses to assign it. The row stays because it is the only role that spans branches — a second property needs it back |
| 1 | Branch Admin | shown as **"Administrator"** — the hotel owner. The real admin |
| 3 | Cashier | |
| 8 | Waiter | |
| 9 | Kitchen | |

Guards: `requireSuperAdmin`, `requireBranchAdminOrAdmin`, `requireCashierOrAbove`,
`requireWaiterOrAbove`. `requireRole` lets Super Admin through every one of them.

**The hotel module is front-desk-and-above** (`routes/hotelRoutes.js` opens with
`router.use(requireAuth, requireCashierOrAbove)`). It used to sit behind
`requireAuth` alone, which meant a kitchen account could cancel a booking, take
a payment, post a charge to a guest's bill, or delete a room type — measured, not
theorised. Property setup (room types, rooms, meal plans, stay policy) needs
`requireBranchAdminOrAdmin` on top. Reads are gated too: bookings and guest
records carry passport and phone numbers the kitchen has no reason to hold.
Nothing on the waiter or kitchen screens calls this module, so the guards cost
them no feature.

A role check on the server must be matched by the **client's** routing, or staff
land on a page that 403s at them. They already are: the waiter and kitchen
sessions are redirected to their own screens.

**`requireAuth` re-reads the account from the database** (30-second cache,
`STATUS_TTL_MS`), and:

- refuses a deactivated account — `u_status` used to be a switch that did nothing
- **overwrites `role_id` from the database**, so a demotion takes effect without
  waiting out the 7-day token, and a forged token gets its real role
- supplies the user's name, so the audit trail reads "Avishka Perera" and not an
  email address

Call `invalidateUserStatus(u_id)` after changing someone's role or status if you
need it to apply faster than 30 seconds.

**`ROLE_RANK` in `userController.js` stops privilege escalation.** Before it, an
Administrator could create a Super Admin — and the result was undeletable through
the API. Nobody may grant a role above their own.

> **Never surface the word "branch" in the UI.** The client has one property. The
> multi-branch architecture stays underneath; the language does not reach the
> screen.

---

## 5. Signing in

Measured on the login endpoint before any of this existed:

| | Before | After |
|---|---|---|
| Guesses against one account | unbounded, ~415,000/day | ~960/day |
| Unknown vs. real email | 31.9/sec vs 1.6/sec | 1135ms vs 1225ms |
| Failed attempts recorded | none, ever | every one |

### Rate limiting — `Server/middleware/rateLimit.js`

- **30 failures per IP / 15 min** — one machine grinding through many accounts
- **10 failures per email / 15 min** — a botnet spreading one account over many IPs

Either alone is trivially avoided; both together are not. Both use
`skipSuccessfulRequests`, so **only failures count** and staff arriving on shift
never accumulate against the limit.

*Accepted trade-off:* the per-account limit lets someone lock a known address out
for 15 minutes deliberately. Unbounded guessing is worse, and the block expires
on its own without anyone having to intervene.

Do **not** write a custom `keyGenerator` for the IP limiter. The default already
keys on IP and normalises IPv6 to a /56. A hand-written one using the
`ipKeyGenerator` helper wrongly (it takes an IP *string*, not `(req, res)`) gives
every request its own bucket, and the limiter silently stops limiting — 18
straight failures went through and nothing warned.

### Timing

An unknown email used to skip `bcrypt.compare` entirely and answer 20× faster,
which let anyone enumerate which staff addresses were real. `login` now compares
against `DECOY_HASH` when the address does not exist, so both paths cost the same.
**Keep it that way** — an early `return` on "user not found" reopens the oracle.

### Passwords

bcrypt, 10 rounds, hashed on every write path. The old fallback that compared the
submitted password directly against the stored column (auto-migrating on match)
has been **removed** — it meant a plaintext password inserted straight into the
database would silently work.

### One browser, one sign-in

The session lives in `localStorage`, which every tab of a browser shares. The
tabs used to disagree about it: one could show a waiter's screen while its
requests and live updates went out as whoever had signed in most recently in
another tab. `AuthProvider` now reads the token and the person together, refuses
a token that has expired before trusting either, and follows a sign-in or
sign-out made in another tab. The socket reconnects when the person changes, so
it is never left sitting in the previous person's rooms.

To work as two people at once — a testing habit, not a real one — use two
browser profiles or a private window. Two tabs of one browser are one session by
design, and the till needs that: the session must survive a reload, or an
offline queue could be flushed by someone other than the person who took the
sales.

A screen that turns someone away sends them to their **own** screen, never back
through the login page. The two used to send each other back and forth —
"Maximum update depth exceeded", then the browser throttling navigation —
whenever a role's home screen would not admit that role, which is exactly what
role 2 did. Each role's home is in `Client/src/utils/roleHome.js`; round 24
fails if any of them names a route that does not admit its own role.

---

## 6. Input validation — `Server/utils/validate.js`

Shared by create booking, edit booking, guests, folio lines and payments, so the
same sentence comes back whichever path the front desk takes.

Before this, the API accepted a 999,999 discount on a 26,000 bill and wrote a
**grand total of −986,799**. Also: negative room rates, an advance far above the
total, 0 adults, 99 guests in a 3-person room, a 2019 check-in, and
`not-an-email`.

| Rule | |
|---|---|
| Discount ≤ the bill | boundary inclusive; one cent over is refused |
| Advance ≤ grand total | same |
| Guests ≤ 2× Σ `max_occupancy` | a typo guard, not an occupancy rule — see below |
| Tax 0–100 | |
| Rate ≥ 0, adults ≥ 1 | |
| Check-in not in the past | **creation only** |
| ≤ 365 nights | also keeps rate × nights inside `NUMERIC(12,2)` |
| Every VARCHAR width | mirrored on the form as `maxLength` |

Two decisions worth keeping:

- **Check-in gets one day of grace.** UTC runs behind Colombo (never ahead), and
  last night's walk-in gets entered this morning. The rule applies to *creation
  only* — an in-house booking necessarily has a past check-in, so enforcing it on
  edit would lock every current guest's record.
- **Editing a booking does not re-check payments already taken.** A correction
  that leaves a guest overpaid is a real situation — a refund is owed. Only
  *inverting* the bill is blocked.
- **Occupancy is cautioned, never refused.** Two small children genuinely do
  share their parents' room, and the front desk is the one who knows whether
  they will. Going over `max_occupancy` shows an amber note on the form and
  books anyway. The server only rejects **more than double** what the rooms
  hold, which is a slipped keystroke rather than a family — and matters because
  the meal-plan supplement is charged per adult and per child per night. Do not
  "tighten" this back into a hard limit: it was one, and it was wrong.

The form mirrors these (`Client/src/pages/hotel/Bookings.jsx`) so the limit shows
while typing rather than after Create — but the form is bypassable, so **the
server is the one that matters**. Never move a rule out of `validate.js` and into
the form only.

### `pattern=` on an input: use `String.raw`

Browsers compile `pattern` with the regex **`v` flag**, where an unescaped `(`,
`)`, `.` or `-` inside a character class is a syntax error — and a pattern that
fails to compile is **ignored entirely**, validating nothing, with no visible
error. `[0-9+(). -]{7,30}` looks fine and accepted `abc-!!`.

```js
pattern: String.raw`[0-9+\(\)\.\- ]{7,30}`
```

`String.raw` because a normal string literal eats the backslashes (`"\("` is just
`"("`), which puts you straight back in the first hole. Test any new pattern with
`new RegExp('^(?:'+p+')$','v')` before trusting it.

### Database errors do not reach the browser

`Server/middleware/errorHandler.js` maps Postgres codes (`22001`, `22003`,
`23505`, `23514`, …) to 400s with readable messages. Anything still 500 is logged
to the server console and the browser gets a generic sentence — a guest should
never see "numeric field overflow".

---

## 7. Audit trail — `ACTIVITY_LOG`

Append-only; nothing in the app updates or deletes rows. 37 call sites across
the controllers cover creates, updates, deletes, payments, check-ins/outs and
sign-ins. The feed falls back gracefully on an action it has no style for, so a
new one shows up as a plain row rather than breaking the page — but add it to
`ACTION` in `Client/src/pages/hotel/ActivityLog.jsx` so it reads properly.

Do not confuse `logActivity({ action })` with `announce({ action })` — the latter
is a Socket.IO payload telling the front desk its rack is stale, and shares
nothing with the audit trail but the word.

Failed sign-ins are recorded as `login_failed` / `login_blocked`, keyed to the
user's **branch when the address is real** (so the owner sees attempts on his own
staff) and **branch NULL when it is not** (super-admin only, so one tenant's noise
never appears in another's feed). Blocks are logged **once per window**, not once
per rejected request, or a sustained attack floods the log it is meant to appear
in.

Logging is fire-and-forget and never throws: an audit write must not be able to
fail a check-in or a sale.

### Retention — `Server/utils/activityRetention.js`

The trail had nothing trimming it, so it grew without limit. It now keeps
**24 months** and prunes daily (a minute after boot, then every 24 h). Set
`ACTIVITY_RETENTION_MONTHS` to change it; **`0` keeps everything forever**, and
the server says which it is at startup:

```
[activity] retention 24 months; pruning daily
```

Two rules make trimming an audit trail acceptable, and both must be kept:

1. **It never touches the records that matter financially.** Bookings, folios,
   payments and commission live in their own tables and are not pruned. This is
   the "who pressed what" trail, not the money.
2. **It writes down what it removed** — `Removed 1,204 activity entries older
   than 24 months`, with the count and the oldest timestamp in `details`. A trail
   that quietly loses entries is worse than one that explains the gap.

The owner can inspect and run it without waiting for the timer:

| | |
|---|---|
| `GET /api/activity/retention` | the window, total entries, and how many are past it |
| `POST /api/activity/retention/prune` | run it now; `{ "dry_run": true }` counts without deleting |

Both are behind the same guard as reading the log (Branch Admin or Admin) —
deleting history is the owner's call, never a till's.

Deletion is batched (5,000 rows) so a long `DELETE` never sits on the table, and
Postgres reclaims the space on vacuum: 199 rows at 192 kB became 14 rows at
112 kB, of which 104 kB is the six indexes' fixed minimum.

---

## 8. The till: voids, approval and where staff may sign in

The threat is not a cashier inventing sales — a fake order makes the drawer
*short*, which hurts them. It is the reverse:

> take the customer's cash → **delete the sale** → the drawer balances → keep the money.

Before this, the hotel side logged everything with an IP and the restaurant till
logged **nothing at all**, and a cashier (or a waiter) could delete a paid order
outright. Four changes:

### A settled sale's lines are frozen

The same trick works one line at a time: leave the sale standing, lift a dish off
it, and that dish's stock comes back while the total stays where it was. It was
possible until 2026-09-16, because `guardOrderStatus` in `orderItemController`
exempted the cashier **by name** from the rule against editing a completed order.

The exemption was there for the till's own settle, which marked an order
completed and then deleted and rewrote every one of its lines. The till now
reconciles lines *before* it settles, and only the ones that actually changed, so
nothing needs the exemption and nobody edits a sale that has been paid for.
Round 26 checks both halves: settling leaves exactly one `sale` entry per line,
and deleting a line from a paid sale is refused with the stock unmoved.

### A ticket is billed once

`PUT /api/orders/:id` carried the same exemption in a different guard: a cashier
was allowed to re-save an order that was already completed. That is not a
cosmetic permission, it is a second sale. Measured on a 900 ticket:

```
first billing:  settle 200, payment 201
second billing: settle 200 ACCEPTED, payment 201 ACCEPTED
                → the order carried 2 payments worth 1,800
```

Two things were conflated. `completed` means *the kitchen has finished cooking*,
and the customer pays afterwards — so the till genuinely has to be able to settle
a ticket that is already completed. What says a ticket has been **billed** is the
tender recorded on it, not its status. The guard keys on the tender now: a
completed ticket with no tender can be settled, because that *is* the billing; one
that already carries a tender is refused with 409; and `POST /api/payments`
refuses anything that would take the takings past what the ticket is worth. The
till's own list stopped offering settled tickets at all — it used to show every
dine-in order the property had ever taken, each with a "Bill & Pay" button on it.

```
second billing: settle 409 — already billed
                payment 409 — already paid in full, 900.00 taken
                → one payment of 900 on a 900 ticket
```

### Sales are voided, never deleted

`POST /api/orders/:id/void` marks the order `cancelled` and keeps the row, with
`void_reason`, `voided_by`, `voided_at` and `approved_by`. Stock the order
consumed is returned. `DELETE /api/orders/:id` is now **Branch Admin or Admin
only** — it is a data-repair tool, not a way to cancel a sale — and is itself
audited.

### A manager's PIN, not a manager's login

`utils/approval.js`. Voiding, and discounts above **10%**, need a manager. Making
them log out and back in would mean sharing a manager password, so instead the
manager types a PIN on the cashier's screen. It is bcrypt-hashed like a password,
every candidate is compared so the timing reveals nothing, and **who approved is
recorded on the order**. A manager doing it themselves needs no second signature.

### The drawer opens only with a PIN

Being signed in to the till was enough to open the cash drawer. Now every drawer
action also needs the property's drawer PIN (`utils/drawerPin.js`), which only
the manager can set, change or read. Five wrong guesses lock that person out for
15 minutes and are logged. The PIN is stored AES-256-GCM-encrypted so the manager
can look it up, and it travels in a header, never a URL. Failures are 403, 423 or
429 — never 401, which the till treats as signed out.

### Sign-in is fenced to the property — carefully

`utils/loginLocation.js`, `LOGIN_LOCATION` table. A hotel has one internet line,
so the building is a usable fence against a cashier working unsupervised from
home. Everything about it **fails open**, because a fence that locks the front
desk out mid-service is a worse outage than the fraud it prevents:

- **Opt-in.** No rules for a property means no restriction at all.
- **Owners are never fenced.** Branch Admin, Admin and Super Admin sign in from
  anywhere, so a changed ISP address never locks out the one person who can fix it.
- **Localhost always passes**, so the system can always be set up and supported.
- A database or parsing error **allows** the login and logs the failure.
- Rules can be disabled without deleting them.
- `POST /api/security/login-locations` accepts `"here"` as the address — you
  cannot fence yourself out of an address you are demonstrably sitting at.

The location check runs **after** the password, so it never becomes a way to
discover which accounts exist. A refusal is recorded as `login_blocked` with the
address.

> This stops the easy path, not a determined insider — they can use the lobby
> wifi. The audit trail is what catches that, which is why it came first.

---

## 9. The till does not decide what things cost

Until 2026-09-06 the server took the total on trust. `POST /orders` accepted
whatever `or_totalcost` it was handed, with no reference to the menu, and the
order-level discount a till applied was never sent at all — only the reduced
number arrived. A 5,000 sale rung up as 1, and a genuinely cheap sale, were the
same row.

That is a quieter way to take cash than voiding: charge the guest full price,
record the sale for less, pocket the difference, and the drawer still balances.
Nothing in the database said a discount had happened, let alone who allowed it.

Two checks now, at the two places money is fixed:

**When a sale is created whole** — `POST /orders/with-items` — the server prices
the lines itself from `Branch_Product` (`" Pro_Price"`, note the leading space in
that column name, and its own `discount_pct`), applies the declared order
discount and service fee, and compares. A total that does not fit is refused
before anything is written.

**When a sale is settled** — `PUT /orders/:id` moving to `completed` — the same
sum is taken over the lines that are actually on the order. This is the older
route, where the header is created before any lines exist, so it cannot be
checked at creation; it is checked at the moment the money is called settled.

Both tolerances are deliberately loose — one rupee or 1%, whichever is larger.
Rounding, tax groups and per-item promotions differ by pennies between the till's
arithmetic and the server's, and a sale must never be refused over a cent. These
catch a bent total, not a rounding error.

**Discounts are recorded and gated.** `discount_pct`, `service_fee` and
`discount_approved_by` are columns on `"ORDER"` (migration `017`). Anything above
`DISCOUNT_APPROVAL_PCT` (10%) needs a manager's PIN, the same one voids use, and
who approved it is stored on the sale and written into the activity log.

Worth knowing: **there is currently no field in the cashier screen for a
order-level discount**, so no cashier can type one today. The gate exists for
when that field is added, and the total check is what actually closes the hole
now — it applies to anything reaching the API, screen or no screen.

---

## 10. Booking a room is a read-then-write

`utils/roomLock.js`. Checking that nothing overlaps and then inserting is two
steps, and two requests that both read before either writes will both book the
room. Measured: three simultaneous requests for one room all returned 201.

`lockRooms()` takes `SELECT ... FOR UPDATE` on the ROOM rows **before** the
overlap check, so concurrent transactions for the same room queue up and the
second one sees the first one's committed booking. Rooms are locked in id order
so two transactions holding different rooms cannot deadlock on each other's.

It also verifies the rooms belong to the caller's property — check-in used to
apply `room_assignments` straight from the request body without checking.

Call `lockRooms` then `roomClash` in that order anywhere rooms are assigned.
`updateBooking` had **no overlap check at all**, so a booking could be edited on
top of another guest deterministically; `roomClash` takes an `ignoreBookingId`
so a booking never clashes with itself.

---

## 11. Money out: supplier payments and the owner's books

**Supplier payments had no login at all.** `routes/supplierPaymentRoutes.js`
mounted its handlers without `requireAuth`, and the controller had no tenant
filter. Anyone who could reach the server could list every company's payments —
supplier names and phone numbers included — and create, change or delete them.
Found on 2026-09-15 by an anonymous `POST` that returned 201. Now: owner-only
(`requireBranchAdminOrAdmin`), every query scoped to the caller's property
through the purchase order, and the overpayment check made under a row lock so
two payments at once cannot both squeeze under the total.

**Expenses could be read and deleted by any signed-in user.** A waiter could read
the salary lines and delete the owner's electricity bill. Now owner-only. Cash
paid out of the till still reaches the books — through the drawer
(`POST /api/cash/session/movement` with a category), not through this route.

**Stock is part of the money.** Only `utils/inventory.js` takes stock for a
sale, and a reversal replays the recorded movement — never a recomputation,
never twice. Room service took no stock at all, and accepted a negative
quantity that would have *added* stock. See `docs/stock-at-sale.md`.

Changing a stock figure by hand is manager-only and always on the ledger with
who and why (`POST /api/raw-materials/:id/count`, `POST /api/branch_products/:id/count`).
The Edit form used to overwrite ingredient stock with no record at all.

## 12. Known gaps

Deliberate, or not yet done. Not hidden.

- ~~A mid-sale network failure fails outright.~~ **Fixed 2026-09-06.** Each sale
  carries a `client_ref` generated on the till before the first send; the server
  keys on it, so resending returns the original order rather than making a
  second. A sale that cannot get through is queued on the till
  (`Client/src/services/offline.js`) and flushed when the connection returns.
  Room charges, settling a waiter's order and sending to the kitchen are refused
  while offline — each needs an answer only the server has.
- **Two validation idioms.** `express-validator` chains in `deliveryController`
  and `paymentController`; hand-rolled helpers everywhere else. The hotel module
  follows the latter. Not worth unifying mid-project, but do not add a third.
- **No password reset.** The login page tells the user to ask their
  administrator, because reset needs email sending that does not exist.
- **No 2FA**, no password strength rule, no forced rotation.
- **`Server/.env` holds live Neon credentials.** Checked: it is covered by
  `Server/.gitignore:5` and is not tracked. Keep it that way — nothing in this
  repo has ever committed it, and it should stay that way when the first real
  commit lands.

---

## 13. Re-testing after a change

The checks below were all run against a live server with hand-minted JWTs. Two
things that matter more than the tests themselves:

1. **Compare content, not counts.** Matching row counts nearly hid the tenant
   leak entirely.
2. **Prove a guard *rejects* something.** Input that passes tells you nothing —
   both the `pattern` bug and the rate-limiter bug were controls that accepted
   everything while looking correct. A misconfigured control fails open and says
   nothing.

Always include `com_id` in a test token, or `/api/branch_products` returns zero
rows and you will chase a phantom.

Worth re-running after touching auth, scope or validation:

- a token from company A against company B's data — expect 404, not 403
- a discount one cent over the bill — expect 400
- 11 failed sign-ins on one address — expect 429 on the 11th
- a correct password five times — expect the limiter never to fire
- an unknown email vs. a real one — expect the same response time
- an anonymous request to `/api/supplier-payments` — expect 401
- a sale of more than the count allows — expect 201, the count below zero, and
  a "beyond the stock count" line in the activity log
- a stock count from a cashier, waiter or kitchen login — expect 403; from the
  owner with no reason — expect 400
- a drawer action with no PIN, then a wrong one, then five wrong ones — expect
  403, 403 with the tries left, then 429; `GET /api/cash/pin` as a cashier — 403
- `GET /api/orders/board` with another company's token — expect none of your
  orders in the answer; with no token at all — 401
- two sockets, one from each company, while the kitchen moves an order along —
  expect the stranger to hear nothing whatsoever
- "ready" and "cancel" sent on one order at the same moment — expect exactly one
  to succeed, and the stock ledger to agree with whichever won
- every role's home in `roleHome.js` against the routes in `App.jsx` — expect
  each to admit its own role; a mismatch is an endless redirect, not a 403

Clean up afterwards: delete test bookings, guests, payments and folio lines, reset
`ROOM.hk_status`, and remove probe rows from `ACTIVITY_LOG`.

Bound that clean-up to the run's own rows. A suite that ended with
`DELETE FROM "ACTIVITY_LOG" WHERE entity='order'` erased the hotel's real record
of who rang up what, every time it ran — the audit trail is the one thing a test
must never tidy away.
