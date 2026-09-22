# The kitchen, as the floor sees it

A waiter looking at the Kitchen Status tab used to see only the orders that
waiter had placed. A table rung up at the till, or a room-service ticket raised
at the front desk, never appeared — so during a busy service the tab read
"No active orders" while the kitchen was working flat out. That is what "the
kitchen status doesn't show in real time" meant.

The tab now shows the property's kitchen: everything waiting, everything
cooking, and everything just marked ready, whoever placed it.

## What the board shows

`GET /api/orders/board` answers with the caller's own property's orders:

* every order that is **waiting** or **being prepared**, however old, and
* every order marked **ready** in the last **30 minutes** (`READY_WINDOW_MINUTES`
  in `Server/controllers/kitchenBoardController.js`).

An order with nothing on it is left out — a waiter's ticket exists for a moment
before its first dish is added, and an empty card on the pass helps nobody.

Each row carries what the floor needs to act: the dishes and their counts, the
table or room, who placed it, how many minutes it has been in its present state,
and `mine` — true for the person asking. Ready orders sort to the top, because
they are the ones somebody has to carry out.

Who may read it is exactly who may already read orders: kitchen staff, waiters,
cashiers and the property's managers. It is the same scope as `GET /api/orders`,
trimmed to what is at the pass.

## How it stays live

The screens do not poll for news; the server tells them.

| Event | Sent when | Who hears it |
| --- | --- | --- |
| `order:new` | an order is created | the property's floor and its managers |
| `order:items` | dishes are added to one | the property's floor and its managers |
| `order:created` | an order or a dish reaches the kitchen | that property's kitchen screens |
| `order:updated` | the kitchen moves it on, or it is voided | the kitchen and the floor |
| `order:ready` | it is marked ready | the person who placed it, by name |
| `order:deleted` | it is taken back or removed | the kitchen and the floor |

Every one of these is addressed to a room belonging to **one property**. The
kitchen room used to be a single room for the whole platform, so every hotel's
kitchen screens were sent every other hotel's orders; adding a dish was
broadcast to every screen connected to the server. Both are now scoped by
property (`getKitchenSocketRoom(b_id)` in `Server/utils/socket.js`).

The waiter's screen reloads the board when it hears any of these, batching a
burst into one refresh — a single sale raises several events. If the connection
drops, a 20-second poll keeps it roughly right and a reconnect reloads at once;
the header says **Live** or **Reconnecting…** so nobody has to guess whether
what they are looking at is current.

## Two screens, one order

Two kitchen tablets, or a tablet and the till, can act on the same order at the
same moment. A status change now applies **only if the order is still where it
was read** — otherwise the second screen is told "This order was just changed on
another screen" (409) instead of one change silently undoing the other. Deleting
an order re-reads it under a lock too, so an order the kitchen has just started
can no longer be deleted out from under it.

Without that, a cancel and a "ready" arriving together could leave an order
marked ready with its ingredients already put back — stock that says one thing
and a ticket that says another.

## When an order is ready

`status_changed_at` (migration `023_kitchen_board.sql`) records when an order
last changed status. It is what lets the board keep a ready order on screen for
half an hour and then let it go: without it there was no telling a dish plated a
minute ago from one served last week. Orders finished before the migration have
no time recorded and stay off the board.

The same migration adds the indexes the board leans on, and one on
`ORDER_ITEM (order_id)` — there was none at all, so every lookup of an order's
lines read the whole table.

## Tickets print themselves

A ticket used to come out blank, with Chrome's own header (`KOT-1328`) on an
otherwise empty sheet. The ticket was parked off-screen with
`position: fixed; left: -9999px` so it would not flash on screen first, and
those inline styles travelled with the copy into the print window — which laid
the ticket out perfectly, 9999 pixels to the left of the paper. The ticket is no
longer attached to the page at all, and the print document now neutralises any
positioning on whatever it is handed.

Printing goes through a hidden frame rather than a pop-up window. A pop-up needs
a click behind it, and a ticket that prints by itself has none, so the browser
blocked it and nothing came out. A frame needs no gesture and leaves no stray
`about:blank` window behind.

The kitchen screen prints a ticket for each order as it arrives, once:

* only orders that are **waiting** and have something to cook;
* the first pass after the screen opens notes what is already on the board
  without printing it, so reloading the page does not reprint the rush;
* what has been printed is remembered per property
  (`kitchen.printedKot:<b_id>`), so a reload mid-service does not repeat it;
* **Auto-print tickets** in the header turns it off and on, and is remembered.

Chrome still shows its print dialog for each ticket. For a kitchen screen that
should simply produce paper, start Chrome with `--kiosk-printing`: it prints to
the default printer with no dialog at all.

The till prints its own copy when it sends an order to the kitchen. That is
deliberate — the paper at the counter and the paper on the pass have to match —
and pressing **Print** on the kitchen screen stamps the copy
`* * R E P R I N T * *`.

## From the kitchen back to the till

Sending food to the kitchen is not billing it. Someone has to come back to the
ticket to take the money, and this is that path:

1. The waiter (or the cashier) sends the order. It carries **its table**, picked
   on the waiter's screen before sending, so the kitchen docket, the till's list
   and the bill all name the same table. "No table (counter)" is a choice, not
   an accident — the ticket used to carry nothing at all, and the till listed it
   as `Table: —`.
2. The kitchen cooks it and marks it ready. `completed` here means *the food is
   done*, not *the customer has paid*.
3. The customer asks to pay. **Kitchen Orders** on the till is one list of every
   ticket the kitchen has — what is still cooking, and anything not yet paid for
   — split inside by who sent it: *From the floor* (a waiter) and *From the till*
   (rung up at this counter). They are all kitchen orders; only the sender
   differs, which is why there is one button rather than two. Each card shows the
   table, the time, who sent it, the dishes, and either **Bill & Pay at Terminal**
   or what it was paid by. Tapping one loads that ticket's own lines into the
   cart — nothing is retyped, and no second order is raised.

   The till asks for a wider list than the kitchen's own screens (`scope=till`):
   a ticket the kitchen finished an hour ago has left the pass but is still money
   nobody has collected.
4. **Checkout** settles that same ticket: it records how it was paid and joins it
   to the cashier's drawer. **PAY NOW** prints the bill and the screen returns to
   the terminal, ready for the next customer.

A ticket leaves that list the moment it is billed and cannot be billed again.
The guard keys on the tender recorded against it rather than its status, so a
ticket the kitchen has already finished can still be settled — once. Before
that, the list showed every dine-in order the property had ever taken, settled
ones included, each with a "Bill & Pay" button, and a second settle with a
second payment went through without a murmur.

Room service never appears in that list. It is charged to the guest's folio when
it is posted and settled at check-out, so no bill prints at the time; the kitchen
docket, carrying the room number and guest name, is what the runner needs.

## Where it lives

| Piece | File |
| --- | --- |
| The board query | `Server/controllers/kitchenBoardController.js` |
| The route | `Server/routes/orderRoutes.js` (`GET /orders/board`, before `/:id`) |
| Rooms and events | `Server/utils/socket.js` |
| Status changes, voids, deletes | `Server/controllers/orderController.js` |
| The waiter's screen | `Client/src/pages/waiter/WaiterPos.jsx` |
| The kitchen's screen | `Client/src/pages/kitchen/KitchenManagement.jsx` |

Tested by round 24 (`r24-kitchen-board`): the board itself, who hears which
event, that another company hears none of them, and that two screens acting at
once cannot undo each other.
