# Hotel POS

A property management system and restaurant point of sale for a hotel: the
front desk, the kitchen, the floor and the till, working from one database.

- **Front desk** — availability, bookings, check-in and check-out, folios,
  room service charged to the room.
- **Restaurant** — a till, a waiter's pad and a kitchen screen that see the
  same orders as they happen.
- **Inventory** — ingredients and stock taken at the moment of sale, purchase
  orders, suppliers, stock counts that record who counted and why.
- **Money** — a cash drawer with an opening float and an end-of-day count,
  expenses, supplier payments, and reports that tie the three together.

React + Vite on the front, Express on the back, Postgres (Neon) underneath,
Socket.IO for anything that has to appear on another screen immediately.

## Getting it running

**You need:** Node 18 or newer, and a Postgres database (Neon's free tier is
what this was built against).

```bash
# 1. dependencies
cd Server && npm install
cd ../Client && npm install

# 2. settings — copy the examples and fill in the two required values
cp Server/.env.example Server/.env      # DATABASE_URL and JWT_SECRET
cp Client/.env.example Client/.env      # usually fine as it comes

# 3. build the database
cd Server && node scripts/migrate.js

# 4. run it — two terminals
cd Server && npm run dev                # API on :5000
cd Client && npm run dev                # app on :3000
```

The server refuses to start without `DATABASE_URL` and `JWT_SECRET`, and says
which is missing. Everything else has a working default; `Server/.env.example`
explains each one.

`node scripts/migrate.js` applies every migration that has not run yet and
records what it did, so running it again is safe. It is the only thing that
should ever change the shape of the database.

## Day one at a property

1. Sign in as the developer account and create the **company**, then the
   **property**, then its **staff** — each person gets their own sign-in, and
   what they can see follows from their role.
2. Add **menu categories**, then the **menu**. Each item is stocked one of
   three ways: counted (a tray of pastries), from a recipe (the ingredients
   decide), or made to order (nothing is counted). See
   [docs/stock-at-sale.md](docs/stock-at-sale.md).
3. Add **ingredients** and, for dishes cooked from a recipe, map them on the
   Recipe Mapper. Stock arrives through a purchase order, not by typing a
   number.
4. Add **rooms and room types** if the property takes bookings, and set the
   cancellation and late-checkout policies.
5. Set the **cash drawer PIN** before the first shift.

## If somebody cannot sign in

An Administrator resets their own staff from **User Management**. That covers
everybody except the account above them.

**A Super Admin can only be reset by another Super Admin.** An Administrator is
scoped to their own property and a Super Admin belongs to none, so the account
is invisible to them — and nobody may act on a role above their own. With a
single Super Admin, losing that password locks the whole platform.

So make a second one, today, and keep it somewhere safe:

```bash
node Server/scripts/create-super-admin.js owner@example.com "Jane" "Perera"
```

Either can then reset the other from User Management, with no terminal and no
developer. The server says so at boot while only one exists.

The two commands for the terminal, when it comes to that:

```bash
node Server/scripts/set-password.js their@email        # a new password for one account
node Server/scripts/set-password.js --list             # which emails can sign in
node Server/scripts/create-super-admin.js --list       # who holds the platform
node Server/scripts/create-super-admin.js them@email --promote   # raise an existing account
```

Both ask for the password twice, never show it, and store only the same bcrypt
hash every account has. Both write what they did to the activity log, and never
the password. They need the server's own database credentials to run, so they
are no weaker than the database itself — and they are the only door left when
every other one is shut.

## Starting a fresh test run

```bash
node Server/scripts/reset-day-to-day.js          # says what would go
node Server/scripts/reset-day-to-day.js --yes    # does it
```

It clears the records a working day writes — tickets, payments, stock
movements, stays, guests, deliveries, the audit trail — and leaves the staff,
the properties, the menu, the recipes, the rooms and the categories alone.
Stock counts go to zero, because the ledger that explained them is gone.

## How it fits together

| | |
|---|---|
| [docs/stock-at-sale.md](docs/stock-at-sale.md) | when stock moves, the three kinds of menu item, and what a void puts back |
| [docs/kitchen-status.md](docs/kitchen-status.md) | the kitchen board, live updates, and how a kitchen ticket gets billed |
| [docs/cash-drawer.md](docs/cash-drawer.md) | the float, the count, and what a variance means |
| [docs/room-service-charge-to-room.md](docs/room-service-charge-to-room.md) | food sent to a room, and where it lands on the bill |
| [docs/occupancy-and-overstays.md](docs/occupancy-and-overstays.md) | what counts as occupied, and what happens when a guest stays on |
| [docs/the-hotels-clock.md](docs/the-hotels-clock.md) | what "today" means to a property that serves past midnight |
| [SECURITY.md](SECURITY.md) | who may see what, and the decisions behind it |

## Deploying

Set `NODE_ENV=production` and `CLIENT_URL` on the server. Without `CLIENT_URL`
the API answers only pages served from its own address, which is right when one
host serves both; set it when the app lives somewhere else. Behind a proxy set
`TRUST_PROXY` to the number of proxies in front, so the rate limiter sees real
callers rather than the proxy.

The client is a static build (`npm run build` in `Client`). If it is served
from the same host as the API, no client settings are needed at all; if not,
set `VITE_API_URL` before building — Vite reads it at build time.
