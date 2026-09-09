# What day is it at the hotel?

**Found:** 2026-09-09 at 00:54 local, while probing business logic.

The property is in Kandy, **UTC+5:30**. The database was running in **GMT**, and
the code built "today" with `new Date().toISOString().slice(0, 10)` — also GMT.

Measured, live, at the moment of the finding:

```
hotel's local date    : 2026-09-09
database CURRENT_DATE : 2026-09-08   (session timezone GMT)
Node toISOString()    : 2026-09-08
```

**Every day between midnight and 05:30 local, the entire system was a day
behind.** Those are precisely the hours a hotel is least supervised: the night
audit, early departures, the last of the restaurant's covers.

## What was wrong because of it

- the **rack**, opened with no date, showed *yesterday*
- **arrivals** listed yesterday's guests
- **overstay detection** (`check_out_date < CURRENT_DATE`) missed a guest due out
  today until half past five
- `effectiveCheckout`'s `CURRENT_DATE + 1` was off by a day, so an overstaying
  guest's room could be released a night early
- **reports** grouped by day, and any "last 7 days" range, started on the wrong day
- commission record dates, expense dates and promotion validity all likewise

## The fix

`Server/utils/hotelTime.js` holds the property's zone explicitly:

```js
export const HOTEL_TZ = process.env.HOTEL_TZ || "Asia/Colombo";
hotelToday()   // YYYY-MM-DD at the property
hotelDay(-7)   // a week ago, on the hotel's calendar
```

Set **explicitly**, not inherited from whichever machine the server runs on — a
server moved to another region must not silently change what "today" means.
That is not hypothetical: the database was moved from Ohio to Singapore the day
before this was found.

The connection pool also opens every session on that clock:

```js
options: `-c timezone=${HOTEL_TZ}`
```

so `CURRENT_DATE` and `NOW()` inside SQL agree with the application. Verified:
both now report `2026-09-09`.

The QA harness was given the same option. A harness sitting in GMT while the app
sits in Asia/Colombo would disagree about what "today" is and quietly test the
wrong day — which is the very bug it is meant to catch.

## Caveat worth knowing

Neon's **pooler** reuses server-side connections, so `ALTER ROLE ... SET timezone`
does not take effect on connections it already holds. The `options` parameter on
each client is what actually carries the zone through. Any *new* client that
forgets it gets GMT again — so if another service is ever pointed at this
database, give it the same option.

---

# And: a refund could invent money

Found in the same round. `POST /bookings/:id/payments` with `kind: "refund"`
accepted **any** amount. A refund of 50,000 against a booking that had paid 5,000
was recorded, leaving `total_paid` at **-45,000**.

Two ways that is wrong: the folio reads as the guest owing 45,000 more than they
do, and it is 45,000 in cash out of the drawer with a receipt to justify it.

Refunds are now capped at what the booking has actually received, with the
message naming the figure: *"Only LKR 5,000.00 has been paid on this booking; a
refund cannot exceed it."*
