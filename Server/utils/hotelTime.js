// utils/hotelTime.js
//
// What day is it at the hotel?
//
// The property is in Kandy (UTC+5:30). The database was running in GMT and the
// code built "today" with `new Date().toISOString().slice(0, 10)`, which is also
// GMT. So every day between midnight and 05:30 local, the whole system was one
// day behind — measured live at 00:54 local, where the rack, the reports and
// CURRENT_DATE all still said yesterday.
//
// Those are exactly the hours a hotel is doing its quietest, least-supervised
// work: the night audit, early departures, the last of the restaurant's covers.
// A rack showing yesterday, arrivals showing yesterday's guests, and a late
// departure not yet counted as late.
//
// A hotel's day is a local thing. It is set here, explicitly, rather than
// inherited from whichever machine the server happens to run on — a server
// moved to another region must not silently change what "today" means.

/** IANA zone for the property. Override with HOTEL_TZ if the hotel moves. */
export const HOTEL_TZ = process.env.HOTEL_TZ || "Asia/Colombo";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOTEL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * Today's date at the property, as YYYY-MM-DD.
 * en-CA formats as YYYY-MM-DD, so this needs no reassembly.
 */
export function hotelToday(d = new Date()) {
  return fmt.format(d);
}

/** The same, offset by whole days — for "tomorrow", "yesterday", ranges. */
export function hotelDay(offset = 0, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + offset);
  return hotelToday(d);
}

/** Wall-clock time at the property, as HH:MM. */
export function hotelTime(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HOTEL_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}
