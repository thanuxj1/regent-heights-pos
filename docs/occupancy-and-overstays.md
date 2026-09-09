# A guest is in the room until somebody checks them out

**Found:** 2026-09-09, from a screenshot. The Bookings list showed eden hazard
**In House** in room 101. The Room Rack, on the same day, showed **all 12 rooms
available**. Two screens, one room, two answers.

## What was wrong

Four separate queries decided whether a room was occupied by comparing the
booking's dates to the date being viewed:

```sql
AND b.check_in_date <= $date AND b.check_out_date > $date
```

eden hazard's stay ran 5–7 September. On the 8th that condition stopped
matching, so every one of those queries concluded the room was free — while
`BOOKING.status` still said `checked_in`, because nobody had checked them out.

A departure date passing does not move a guest or their luggage. **An overstay
is still an occupancy.**

## What it actually cost

Not just a wrong colour on a screen. Reproduced in `r17-hotel-stories.cjs`:

| Screen | Said |
|---|---|
| Room rack | available (it fell through to housekeeping status: "dirty") |
| Availability search | offered the room for tonight |
| `roomClash`, the overlap guard | no clash — **so a walk-in was sold the room** |

The last one is the real damage: two guests holding one room, discovered at
11pm at the front desk.

## The rule now

`Server/utils/occupancy.js` holds it once, and all four callers use it:

```js
effectiveCheckout(alias)  // GREATEST(check_out_date, CURRENT_DATE + 1) while checked_in
```

A checked-in stay is extended to **at least tomorrow** — never further. Both
halves matter:

- extended, so an overstaying guest blocks *tonight's* sale;
- only to tomorrow, so they do not block a booking three weeks out that
  housekeeping will have turned over long before.

Callers: `utils/roomLock.js` (the overlap guard), `controllers/bookingController.js`
(availability), `controllers/frontDeskController.js` (the rack),
`controllers/roomController.js` (the rooms list).

## And it is visible

The rack marks an overdue departure with a red border and a **LATE** tag, and
the legend gains an **Overdue** count. Occupied rooms already looked occupied;
what the desk could not see was *which* guest should have gone. That is a bill
to close and a room housekeeping is waiting on.

## Also fixed in the same round

**A room out of order could still be booked.** Availability hid it, but posting
the room id directly was accepted — a room can also be taken out of service
after a booking screen is opened. The refusal now sits in `lockRooms`, which
every booking write passes through, so create / edit / check-in all get it.

## The lesson for the tests

Every earlier suite tested one endpoint at a time and all of them passed. The
bug lived *between* screens. `r17` and `r18` are written as stories — a guest
arrives, stays, orders food, overstays, argues about the bill — and one story
asks several screens the same question and requires one answer.

Two of those tests were also found to be passing vacuously: `?? 0` fallbacks
meant a missing folio compared `0` to `0`. A test that cannot fail is worse
than no test.
