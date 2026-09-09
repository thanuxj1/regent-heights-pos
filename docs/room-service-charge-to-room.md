# Room service: food charged to the guest's room

## The user story

> **As** a cashier at the front desk,
> **when** a guest telephones from their room and asks for food,
> **I want** to take the order in the POS and charge it to their room,
> **so that** the kitchen starts cooking, no money changes hands at the till, and
> the amount is already on the guest's bill when they check out.

### Why it needed building

The mechanism existed but the till could not reach it. Room-service orders could
only be raised from the **Room Rack**, a front-desk screen — so the person on the
phone, sitting at the POS, had no way to take the order without either walking to
another screen or ringing it up as a cash sale that never reached the guest's bill.

Worse, the POS *appeared* to support it: it had a **"Room Service" category** that
was pure theatre. It sorted products by keyword — anything whose name contained
"room", "suite", "laundry" or "parking" landed there. It had no connection to any
room, any guest, or any bill.

---

## The scenario

**Given** Mr Silva is checked in to Room 204 with an open folio,
**and** the cashier is signed in at the POS,

| # | Step | What happens |
|---|---|---|
| 1 | Guest phones: two club sandwiches and a pot of tea | — |
| 2 | Cashier adds the items to the cart | Normal POS behaviour |
| 3 | Cashier picks **Payment → Room** | The picker opens **immediately** — "Room" is a question, so it is asked at once rather than leaving a second tap in the way |
| 4 | Picker shows what is on offer | A search box and a card per room — **every** room, laid out like the rack. Rooms with a guest are live and show the name; the rest are greyed and disabled with the reason: *Empty*, *Arriving — not checked in*, *Needs cleaning* |
| 5 | Types `204`, or `Silva` | Matches on room number, guest name or room type — a property with eighty rooms is searched, not scrolled |
| 6 | Taps *Room 204 — Mr Silva* | The sidebar shows `Room 204 / Mr Silva / Change`, with *"Goes to the kitchen and onto the guest's bill. Nothing is collected now."* |
| 6a | Wrong room? | **Change** reopens the picker. It states the choice three ways — a green subtitle *"Currently: Room 204 — Mr Silva"*, a banner *"Charging to Room 204"* with a **Clear** button, and a **✓ SELECTED** badge with a ring on the card itself. Tapping another card switches to it |
| 7 | Cashier presses **Charge to Room 204** | The button says the room, so there is no doubt what it will do. Pressing it with no room chosen opens the picker rather than erroring |

**Nothing is remembered between orders.** A successful charge clears the room and
returns Payment to Cash, so the next customer's food can never be billed to the
last guest's room. Pressing **Room** again opens a fresh picker with nothing
pre-selected.

In Room mode there is **one** action. **Send to Kitchen (KOT) is hidden**, because
charging the room already tickets the kitchen *and* bills the guest in a single
transaction. While it was visible, a cashier could press it first and send a
second, detached order — cooked by the kitchen, charged to nobody.

**Then**

- an `ORDER` is created with `or_type = 'room_service'`, carrying the `room_id`
  and the guest's `folio_id`
- a **KOT prints** and the kitchen screen receives the ticket, marked with the
  room number and guest name — the kitchen knows where it is going
- a `FOLIO_ITEM` is posted to Mr Silva's folio **immediately**, described as
  `Room service — order #123`
- **no payment is recorded and the cash drawer stays shut**
- the till confirms: *"Charged to Room 204 — Mr Silva. It will appear on their
  bill at check-out."*

**And when Mr Silva checks out**

- the folio already carries the line; check-out's sweep of unbilled orders
  matches on `ref_order_id` and **does not add it twice**
- it appears on the printed bill under **Restaurant**, between the room charge
  and any late-checkout fee
- the balance includes it, and check-out is refused until the bill is settled

### The paths that must fail

| Situation | What happens |
|---|---|
| Room chosen, but the guest checked out a minute ago | 409 — *"That room has no checked-in guest with an open folio"*. The stale selection is **dropped** and the room list refreshed, so the cashier re-picks instead of pressing a doomed button again. **The cart is kept** — the order is not lost |
| **Room** selected but no room picked | Checkout opens the picker instead of erroring — nothing is sent |
| No guests checked in at all | The list is replaced by *"No guests are checked in, so there is no room to charge. Take payment instead."* |
| A room merely **booked** for tonight | Shown greyed as *"Arriving — not checked in"* and not clickable — the guest has no folio yet |
| A room whose booking has lost its guest record | Greyed as *"No guest on file"*. `status` alone is not proof: a checked-in booking with no guest reads as occupied and the API refuses it |
| Another company's room id, posted directly to the API | 403/404 — the room must belong to the caller's property |
| Kitchen or waiter account trying to charge a room | 403 — room service is front-desk work |

---

## Where it lives

| Piece | File |
|---|---|
| Endpoint (order + kitchen ticket + folio line, one transaction) | `Server/controllers/frontDeskController.js` → `createRoomServiceOrder` |
| Route, front-desk-and-above | `Server/routes/hotelRoutes.js` → `POST /hotel/room-service` |
| Till UI and the room picker | `Client/src/pages/cashier/CashierPos.jsx` |
| The same flow from the rack | `Client/src/pages/hotel/RoomRack.jsx` |
| Check-out's sweep of unbilled orders | `Server/controllers/bookingController.js` → `checkOut` |

Both entry points call the **same endpoint**, so the rack and the till can never
disagree about what a room service order does.

## Two things to keep

- **Charging to a room is not a payment method**, even though it sits in the
  payment row. Nothing is collected; the debt moves to the folio. That is why the
  room must be named before Checkout will do anything.
- **Vacant rooms are greyed, not hidden.** A cashier told "room 105" must be able
  to see that 105 exists and is empty. Hiding it returns "no match", which reads
  as *did I mishear the number?* rather than *nobody is in there*.
- **The room picker is a search, not a list.** It began as a `<select>` in the
  340px sidebar, which was already truncating guest names at twelve rooms and
  would be unusable at eighty. Do not put it back: the cashier is holding a phone
  and has been given either a number or a name, and either one finds the room.
- **The POS category chips are the menu's real categories now**, read from the
  `category` table — the same list the owner edits under *Restaurant → Menu
  Categories*. Do not reintroduce keyword guessing: a product called "Mushroom
  Soup" was being filed under Room Service because its name contains "room".
