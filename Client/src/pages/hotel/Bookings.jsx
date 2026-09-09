import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getBookings, createBooking, getAvailability, getMealPlans, getGuests, getAgents,
} from "../../services/api";
import {
  card, input, label, btn, badge, th, td,
  modalWrap, modalBox, errorBox, money, numOr, dmy, today, ymd, addDays,
  nightsBetween, initials, STATUS_STYLE,
} from "./ui";
import { COUNTRIES } from "../../constants/countries";

/** Matches the widths of the GUEST columns, so a long value is stopped here
 *  rather than 150 characters later by Postgres. */
const GUEST_FIELDS = [
  { k: "full_name",    l: "Full Name *",      t: "text",  max: 150, required: true },
  { k: "phone",        l: "Phone",            t: "tel",   max: 30,
    // String.raw, because the browser compiles `pattern` with the regex "v" flag,
    // where an unescaped ( ) . or - inside a class is a syntax error — and a
    // pattern that fails to compile is silently ignored, validating nothing.
    pattern: String.raw`[0-9+\(\)\.\- ]{7,30}`,
    title: "Digits, spaces and + ( ) - only, at least 7 of them." },
  { k: "email",        l: "Email",            t: "email", max: 150 },   // checked live, see EMAIL_RE
  // Countries only. Nationality takes a demonym ("Spanish", not "Spain"), so
  // offering the same list there would put the wrong word in the box.
  { k: "country",      l: "Country / Region", t: "text",  max: 80, list: "guest-countries" },
  { k: "nationality",  l: "Nationality",      t: "text",  max: 80 },
  { k: "passport_nic", l: "Passport / NIC",   t: "text",  max: 50 },
];

/** Mirrors MAX_MONEY on the server. */
const MAX_MONEY = 9999999.99;

/** Same shape the server enforces, so the form never promises what the API refuses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const overStyle = { border: "1px solid #DC2626", background: "#FEF2F2" };
const hint = { display: "block", marginTop: 4, fontSize: 11, fontWeight: 600, color: "#DC2626" };

const SOURCES = [
  ["phone", "Phone"], ["walk_in", "Walk-in"], ["email", "Email"],
  ["agent", "Agent"], ["online", "Online"], ["ota", "OTA / booking.com"],
];

// Must live at module scope. Declaring it inside a component makes React treat it
// as a brand-new component type on every render, which unmounts and remounts the
// whole subtree — the inputs get rebuilt and lose focus after a single keystroke.
const Section = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", textTransform: "uppercase",
                  letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #F1F5F9" }}>
      {title}
    </div>
    {children}
  </div>
);

export default function Bookings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [showNew, setShowNew] = useState(searchParams.get("new") === "1");
  const [mealPlans, setMealPlans] = useState([]);
  const [guests, setGuests] = useState([]);
  const [agents, setAgents] = useState([]);

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = { b_id: branchId };
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      setBookings(await getBookings(params));
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [branchId, statusFilter]);

  useEffect(() => {
    if (!branchId) return;
    Promise.all([
      getMealPlans({ b_id: branchId }),
      getGuests(),
      getAgents({ b_id: branchId }),
    ]).then(([mp, g, a]) => { setMealPlans(mp); setGuests(g); setAgents(a); }).catch(() => {});
  }, [branchId]);

  const closeNew = () => {
    setShowNew(false);
    if (searchParams.get("new")) { searchParams.delete("new"); setSearchParams(searchParams, { replace: true }); }
  };

  return (
    <AppShell title="Bookings">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load()}
              placeholder="Search by ref, guest name or phone…"
              style={{ ...input, width: 280 }}
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...input, width: 170 }}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={load} style={btn("ghost")}>Search</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowNew(true)} style={btn("primary")}>+ New Booking</button>
          </div>

          <div style={{ ...card, overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>Loading bookings…</div>
            ) : bookings.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>
                No bookings yet. Create the first one with <strong>+ New Booking</strong>.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ background: "#F8FAFC" }}>
                    {["Ref", "Guest", "Stay", "Rooms", "Total", "Balance", "Status", ""].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {bookings.map(b => {
                      const st = STATUS_STYLE[b.status] || {};
                      const balance = Number(b.grand_total || 0) - Number(b.paid_total || 0);
                      return (
                        <tr key={b.booking_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                          <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{b.booking_ref}</td>
                          <td style={td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#1565C0", color: "#fff",
                                            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11 }}>
                                {initials(b.guest_name)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, color: "#1E293B" }}>{b.guest_name || "—"}</div>
                                <div style={{ fontSize: 11, color: "#94A3B8" }}>{b.guest_phone || b.guest_country || ""}</div>
                              </div>
                            </div>
                          </td>
                          <td style={td}>
                            {dmy(b.check_in_date)} → {dmy(b.check_out_date)}
                            <div style={{ fontSize: 11, color: "#94A3B8" }}>{b.nights} night(s)</div>
                          </td>
                          <td style={td}>{(b.rooms || []).map(r => r.room_number ? `#${r.room_number}` : r.type_name).join(", ") || "—"}</td>
                          <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{money(b.grand_total)}</td>
                          <td style={{ ...td, fontWeight: 700, color: balance > 0 ? "#DC2626" : "#059669" }}>{money(balance)}</td>
                          <td style={td}><span style={badge(st)}>{st.label || b.status}</span></td>
                          <td style={td}>
                            <button onClick={() => navigate(`/hotel/bookings/${b.booking_id}`)} style={btn("ghost")}>Open</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

      {showNew && (
        <NewBookingModal
          branchId={branchId}
          mealPlans={mealPlans}
          guests={guests}
          agents={agents}
          onClose={closeNew}
          onCreated={(bk) => { closeNew(); load(); navigate(`/hotel/bookings/${bk.booking_id}`); }}
        />
      )}
    </AppShell>
  );
}

/**
 * Pick a returning guest by typing.
 *
 * A <select> is fine for a handful of guests and useless once a property has a
 * few hundred: the receptionist has the name in front of them and wants to type
 * it, not scroll. Matches on name, phone or passport, since a caller who has
 * stayed before is usually identified by their number.
 */
function GuestPicker({ guests, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const [active, setActive] = useState(0);

  const chosen = guests.find(g => String(g.guest_id) === String(value));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guests.slice(0, 8);
    return guests.filter(g =>
      `${g.full_name || ""} ${g.phone || ""} ${g.passport_nic || ""} ${g.country || ""}`
        .toLowerCase().includes(q)
    ).slice(0, 8);
  }, [guests, query]);

  const pick = (g) => { onChange(String(g.guest_id)); setQuery(""); setOpen(false); };

  if (chosen) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                    border: "1px solid #1565C0", borderRadius: 8, background: "#EFF6FF" }}>
        <span style={{ fontSize: 13, color: "#1E293B", fontWeight: 600 }}>{chosen.full_name}</span>
        <span style={{ fontSize: 12, color: "#64748B" }}>
          {chosen.phone || ""}{chosen.country ? ` · ${chosen.country}` : ""}
        </span>
        <button type="button" onClick={() => { onChange(""); setQuery(""); }}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "#1565C0",
                   fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query} autoComplete="off"
        placeholder="Type a name, phone or passport number…"
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}   // let a click land first
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={input}
      />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4,
                      background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(15,23,42,0.12)", maxHeight: 240, overflowY: "auto" }}>
          {matches.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#94A3B8" }}>
              No guest matches “{query.trim()}” — switch to <strong>New guest</strong> to add them.
            </div>
          ) : matches.map((g, i) => (
            <div key={g.guest_id}
              onMouseDown={() => pick(g)} onMouseEnter={() => setActive(i)}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13,
                       background: i === active ? "#EFF6FF" : "transparent",
                       borderBottom: i === matches.length - 1 ? "none" : "1px solid #F1F5F9" }}>
              <div style={{ color: "#1E293B", fontWeight: 600 }}>{g.full_name}</div>
              <div style={{ color: "#94A3B8", fontSize: 11.5 }}>
                {[g.phone, g.country, g.passport_nic].filter(Boolean).join(" · ") || "no other details"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── New Booking ─────────────────────────────────────────────────────────────

function NewBookingModal({ branchId, mealPlans, guests, agents, onClose, onCreated }) {
  const [checkIn, setCheckIn]   = useState(today());
  const [checkOut, setCheckOut] = useState(ymd(addDays(new Date(), 1)));
  const [avail, setAvail]       = useState(null);
  const [searching, setSearching] = useState(false);

  const [picked, setPicked] = useState([]); // [{room_type_id,type_name,room_id,room_number,rate_per_night}]
  const [adults, setAdults]     = useState(2);
  const [children, setChildren] = useState(0);
  const [mealPlanId, setMealPlanId] = useState("");
  const [taxPct, setTaxPct]     = useState(10);
  const [extras, setExtras]     = useState(0);
  const [discount, setDiscount] = useState(0);
  const [advance, setAdvance]   = useState(0);
  const [advanceMethod, setAdvanceMethod] = useState("cash");
  const [source, setSource]     = useState("phone");
  const [agentId, setAgentId]   = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [remarks, setRemarks]   = useState("");

  const [existingGuest, setExistingGuest] = useState("");
  const [newGuestMode, setNewGuestMode]   = useState(true);
  const [guest, setGuest] = useState({ full_name: "", phone: "", email: "", country: "", nationality: "", passport_nic: "" });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nights = Math.max(nightsBetween(checkIn, checkOut), 0);

  const doSearch = async () => {
    setError(""); setSearching(true); setAvail(null);
    try {
      setAvail(await getAvailability({ b_id: branchId, check_in: checkIn, check_out: checkOut }));
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load availability");
    } finally { setSearching(false); }
  };

  useEffect(() => { if (branchId && nights > 0) doSearch(); /* eslint-disable-next-line */ }, [branchId]);

  const addRoom = (type, room) => {
    if (picked.some(p => p.room_id === room.room_id)) return;
    setPicked(p => [...p, {
      room_type_id: type.room_type_id, type_name: type.type_name,
      room_id: room.room_id, room_number: room.room_number,
      rate_per_night: Number(type.base_rate) || 0,
      max_occupancy: Number(type.max_occupancy) || 0,
    }]);
  };
  const removeRoom = (roomId) => setPicked(p => p.filter(x => x.room_id !== roomId));
  const setRate = (roomId, rate) =>
    setPicked(p => p.map(x => x.room_id === roomId ? { ...x, rate_per_night: rate } : x));

  const plan = mealPlans.find(m => String(m.plan_id) === String(mealPlanId));

  // How many people the selected rooms hold, and how much of the bill can be
  // given away — the same two ceilings the server enforces, shown while typing
  // rather than thrown back after Create.
  const capacity = picked.reduce((s, r) => s + (r.max_occupancy || 0), 0);
  const people   = numOr(adults, 0) + numOr(children, 0);

  const totals = useMemo(() => {
    const room = picked.reduce((s, r) => s + Number(r.rate_per_night || 0) * nights, 0);
    const meal = plan
      ? (Number(adults) * Number(plan.supplement_per_adult || 0) +
         Number(children) * Number(plan.supplement_per_child || 0)) * nights
      : 0;
    const tax = room * (Number(taxPct) || 0) / 100;
    const beforeDiscount = room + tax + meal + numOr(extras);
    const grand = beforeDiscount - numOr(discount);
    return { room, meal, tax, beforeDiscount, grand, balance: grand - numOr(advance) };
  }, [picked, nights, plan, adults, children, taxPct, extras, discount, advance]);

  // Over the nominal occupancy is the desk's call, not ours — a cot or a shared
  // bed is an everyday answer. Say so, and let them book it.
  const overCapacity = capacity > 0 && people > capacity;

  const overDiscount = numOr(discount) > totals.beforeDiscount + 0.001;
  // While the discount is out of range the grand total is meaningless (it goes
  // negative), so judging the advance against it would flag even an advance of 0.
  const overAdvance  = !overDiscount && numOr(advance) > totals.grand + 0.001;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!picked.length)  { setError("Select at least one room."); return; }
    if (nights < 1)      { setError("Check-out must be after check-in."); return; }
    if (nights > 365)    { setError("A booking cannot run longer than 365 nights."); return; }
    if (newGuestMode && !guest.full_name.trim()) { setError("Guest name is required."); return; }
    if (!newGuestMode && !existingGuest)         { setError("Select a guest."); return; }
    if (numOr(adults, 0) < 1) { setError("At least one adult is required."); return; }
    if (source === "agent" && !agentId) { setError("Choose the agent this booking came through."); return; }
    if (overDiscount) { setError(`Discount cannot be more than ${money(totals.beforeDiscount)}.`); return; }
    if (overAdvance)  { setError(`Advance payment cannot be more than the grand total of ${money(totals.grand)}.`); return; }

    setSubmitting(true);
    try {
      const bk = await createBooking({
        b_id: branchId,
        guest_id: newGuestMode ? undefined : Number(existingGuest),
        guest: newGuestMode ? guest : undefined,
        agent_id: agentId || undefined,
        source,
        check_in_date: checkIn,
        check_out_date: checkOut,
        adults: numOr(adults, 1), children: numOr(children, 0),
        meal_plan_id: mealPlanId || undefined,
        arrival_time: arrivalTime || undefined,
        special_requests: specialRequests || undefined,
        remarks: remarks || undefined,
        tax_pct: numOr(taxPct, 10),
        extra_charges: numOr(extras), discount: numOr(discount),
        advance_payment: numOr(advance), advance_method: advanceMethod,
        rooms: picked.map(p => ({
          room_id: p.room_id, room_type_id: p.room_type_id, rate_per_night: p.rate_per_night,
        })),
      });
      onCreated(bk);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not create booking");
    } finally { setSubmitting(false); }
  };

  return (
    <div style={modalWrap}>
      <div style={modalBox(860)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#1E293B" }}>New Reservation</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={submit}>
          <datalist id="guest-countries">
            {COUNTRIES.map(c => <option key={c} value={c} />)}
          </datalist>

          <Section title="Stay Dates & Guests">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, alignItems: "end" }}>
              <label style={label}>Check-In
                <input type="date" value={checkIn} min={today()}
                  onChange={e => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(ymd(addDays(new Date(e.target.value), 1))); }}
                  style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Check-Out
                <input type="date" value={checkOut} min={ymd(addDays(new Date(checkIn), 1))}
                  onChange={e => setCheckOut(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <div style={{ padding: "9px 14px", background: "#EFF6FF", borderRadius: 8, fontWeight: 700, color: "#1565C0", fontSize: 13 }}>
                {nights} night{nights === 1 ? "" : "s"}
              </div>
              <button type="button" onClick={doSearch} disabled={searching} style={btn("primary")}>
                {searching ? "Checking…" : "Check Availability"}
              </button>
            </div>

            {/* Party size belongs here, not below the room list: it is what makes a
                room suitable, so the cashier has to set it before choosing one. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, marginTop: 12, alignItems: "end" }}>
              <label style={label}>Adults
                <input type="number" min={1} max={99} step="1" required value={adults}
                  onChange={e => setAdults(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Children
                <input type="number" min={0} max={99} step="1" required value={children}
                  onChange={e => setChildren(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <div style={{ fontSize: 12, color: "#64748B", paddingBottom: 10 }}>
                Booking for <strong style={{ color: "#1E293B" }}>{people} guest{people === 1 ? "" : "s"}</strong>
                {picked.length > 0 && (
                  <span style={{ color: overCapacity ? "#B45309" : "#059669", fontWeight: 600 }}>
                    {" · "}{picked.length} room{picked.length === 1 ? "" : "s"} selected, holding up to {capacity}
                    {overCapacity ? " — above that" : " ✓"}
                  </span>
                )}
              </div>
            </div>
          </Section>

          {avail && (
            <Section title="Available Rooms">
              {avail.room_types.every(t => t.available_rooms.length === 0) ? (
                <div style={{ padding: 20, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  No rooms free for those dates.
                </div>
              ) : avail.room_types.map(t => {
                const holds  = Number(t.max_occupancy) || 0;
                // How many of this type it would take to seat the party. Never
                // disable a "small" type — two Standard Doubles is a perfectly
                // good answer for four guests.
                const needed = holds > 0 ? Math.ceil(people / holds) : 0;
                return (
                <div key={t.room_type_id} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#1E293B" }}>
                      {t.type_name}
                      <span style={{ color: "#94A3B8", fontWeight: 400 }}>
                        {" · sleeps "}{t.base_occupancy}{holds > t.base_occupancy ? `, up to ${holds}` : ""}
                      </span>
                      {needed === 1 && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#059669" }}>
                          fits all {people}
                        </span>
                      )}
                      {needed > 1 && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#B45309" }}>
                          {people} guests: {needed} rooms, or extra bedding
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 13, color: "#1565C0", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {money(t.base_rate)}/night
                    </span>
                  </div>

                  {t.description && (
                    <div style={{ fontSize: 12, color: "#64748B", marginBottom: 6 }}>{t.description}</div>
                  )}

                  {Array.isArray(t.amenities) && t.amenities.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      {t.amenities.map(a => (
                        <span key={a} style={{ fontSize: 10.5, color: "#475569", background: "#F1F5F9",
                                               border: "1px solid #E2E8F0", borderRadius: 20, padding: "2px 9px" }}>
                          {a}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {t.available_rooms.length === 0 ? (
                      <span style={{ fontSize: 12, color: "#DC2626" }}>Fully booked ({t.total_rooms} rooms)</span>
                    ) : t.available_rooms.map(r => {
                      const on = picked.some(p => p.room_id === r.room_id);
                      return (
                        <button key={r.room_id} type="button"
                          onClick={() => on ? removeRoom(r.room_id) : addRoom(t, r)}
                          style={{
                            padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                            border: on ? "2px solid #1565C0" : "1px solid #E2E8F0",
                            background: on ? "#1565C0" : "#fff", color: on ? "#fff" : "#475569",
                          }}>
                          {r.room_number} {on ? "✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </Section>
          )}

          {picked.length > 0 && (
            <Section title="Selected Rooms & Rates">
              {picked.map(p => (
                <div key={p.room_id} style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 12,
                                              alignItems: "center", marginBottom: 8, padding: "10px 14px",
                                              background: "#F8FAFC", borderRadius: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>Room {p.room_number}</strong>
                    <span style={{ color: "#94A3B8" }}> · {p.type_name}</span>
                  </div>
                  <label style={{ ...label, fontSize: 11 }}>Rate / night
                    <input type="number" min={0} step="0.01" value={p.rate_per_night}
                      onChange={e => setRate(p.room_id, e.target.value)}
                      style={{ ...input, marginTop: 2, padding: "6px 10px", fontSize: 13 }} />
                  </label>
                  <button type="button" onClick={() => removeRoom(p.room_id)} style={btn("danger")}>Remove</button>
                </div>
              ))}
            </Section>
          )}

          <Section title="Guest">
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              {[[true, "New guest"], [false, "Existing guest"]].map(([mode, txt]) => (
                <label key={txt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#475569" }}>
                  <input type="radio" checked={newGuestMode === mode} onChange={() => setNewGuestMode(mode)} />
                  {txt}
                </label>
              ))}
            </div>
            {newGuestMode ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {GUEST_FIELDS.map(f => {
                  const badEmail = f.k === "email" && guest.email.trim() && !EMAIL_RE.test(guest.email.trim());
                  return (
                    <label key={f.k} style={label}>{f.l}
                      <input type={f.t} value={guest[f.k]} maxLength={f.max} required={f.required}
                        pattern={f.pattern} title={f.title} list={f.list}
                        autoComplete={f.k === "country" ? "off" : undefined}
                        onChange={e => setGuest(g => ({ ...g, [f.k]: e.target.value }))}
                        style={{ ...input, marginTop: 4, ...(badEmail ? overStyle : null) }} />
                      {badEmail && <span style={hint}>That doesn't look like an email address</span>}
                    </label>
                  );
                })}
              </div>
            ) : (
              <GuestPicker guests={guests} value={existingGuest} onChange={setExistingGuest} />
            )}
          </Section>

          <Section title="Stay Details">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              <label style={label}>Meal Plan
                <select value={mealPlanId} onChange={e => setMealPlanId(e.target.value)} style={{ ...input, marginTop: 4 }}>
                  <option value="">Room Only</option>
                  {mealPlans.map(m => <option key={m.plan_id} value={m.plan_id}>{m.plan_name}</option>)}
                </select>
              </label>
              <label style={label}>Arrival Time
                <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Source
                <select value={source}
                  onChange={e => {
                    setSource(e.target.value);
                    // An agent only belongs to an agent booking. Leaving a stale
                    // one behind would pay commission on a walk-in.
                    if (e.target.value !== "agent") setAgentId("");
                  }}
                  style={{ ...input, marginTop: 4 }}>
                  {SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              {source === "agent" && (
                <label style={label}>Referring Agent *
                  <select value={agentId} required onChange={e => setAgentId(e.target.value)}
                    style={{ ...input, marginTop: 4 }}>
                    <option value="">Select an agent…</option>
                    {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>)}
                  </select>
                  {agents.length === 0 && (
                    <span style={hint}>No agents yet — add one under Commission Agents</span>
                  )}
                </label>
              )}
              <label style={{ ...label, gridColumn: source === "agent" ? "span 2" : "span 3" }}>Special Request
                <input value={specialRequests} maxLength={2000} onChange={e => setSpecialRequests(e.target.value)}
                  placeholder="e.g. Honeymoon decoration & cake" style={{ ...input, marginTop: 4 }} />
              </label>
            </div>
          </Section>

          <Section title="Charges">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
              <label style={label}>Tax %
                <input type="number" min={0} max={100} step="0.01" required value={taxPct}
                  onChange={e => setTaxPct(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Extra Charges
                <input type="number" min={0} max={MAX_MONEY} step="0.01" required value={extras}
                  onChange={e => setExtras(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Discount
                <input type="number" min={0} max={MAX_MONEY} step="0.01" required value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  style={{ ...input, marginTop: 4, ...(overDiscount ? overStyle : null) }} />
                {overDiscount && <span style={hint}>Most you can take off is {money(totals.beforeDiscount)}</span>}
              </label>
              <label style={label}>Advance Payment
                <input type="number" min={0} max={MAX_MONEY} step="0.01" required value={advance}
                  onChange={e => setAdvance(e.target.value)}
                  style={{ ...input, marginTop: 4, ...(overAdvance ? overStyle : null) }} />
                {overAdvance && <span style={hint}>Grand total is only {money(totals.grand)}</span>}
              </label>
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
              {/* One line per room showing its own arithmetic. "Total Room Charges
                  24,000" for a 12,000 room is correct but unreadable — nothing on
                  the line said whether the doubling was nights or rooms. */}
              {picked.map(p => (
                <div key={p.room_id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: "#64748B" }}>
                  <span>
                    Room {p.room_number}
                    <span style={{ color: "#94A3B8" }}>
                      {" · "}{nights} night{nights === 1 ? "" : "s"} × {money(p.rate_per_night)}
                    </span>
                  </span>
                  <span style={{ color: "#1E293B", fontWeight: 600 }}>
                    {money(numOr(p.rate_per_night) * nights)}
                  </span>
                </div>
              ))}

              {[
                ...(picked.length > 1 ? [["Total Room Charges", money(totals.room), "#1E293B"]] : []),
                [`Room Charges Tax (${taxPct}%)`, money(totals.tax), "#1E293B"],
                ...(totals.meal ? [["Inclusions (meal plan)", money(totals.meal), "#1E293B"]] : []),
                ...(Number(extras) ? [["Extra Charges", money(extras), "#1E293B"]] : []),
                ...(Number(discount) ? [["Discount", `-${money(discount)}`, "#DC2626"]] : []),
              ].map(([k, v, c]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: "#64748B" }}>
                  <span>{k}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 5px", marginTop: 6,
                            borderTop: "2px solid #CBD5E1", fontSize: 15, fontWeight: 700,
                            color: totals.grand < 0 ? "#DC2626" : "#1E293B" }}>
                <span>Grand Total</span><span>{money(totals.grand)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, color: "#64748B" }}>
                <span>Total Paid</span><span>{money(advance)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14, fontWeight: 700,
                            color: totals.balance > 0 ? "#DC2626" : "#059669" }}>
                <span>Amount Due at Check-In</span><span>{money(totals.balance)}</span>
              </div>
            </div>
          </Section>

          {overCapacity && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12, padding: "11px 14px",
                          background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8,
                          fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>⚠</span>
              <span>
                <strong>{people} guests</strong> in {picked.length === 1 ? "a room that normally holds" : "rooms that normally hold"}{" "}
                <strong>{capacity}</strong>. Fine for young children sharing — just make sure the extra bedding is arranged.
                You can still create this booking.
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 12 }}>Cancel</button>
            <button type="submit" disabled={submitting} style={{ ...btn("primary"), flex: 2, padding: 12, opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Creating…" : "Create Booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
