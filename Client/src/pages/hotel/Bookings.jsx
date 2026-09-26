import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getBookings, createBooking, updateBooking, updateGuest, getAvailability, getGuests, getAgents, getStayPolicy,
} from "../../services/api";
import {
  card, input, label, btn, badge, th, td,
  modalWrap, modalBox, errorBox, money, numOr, dmy, today, ymd, addDays,
  nightsBetween, initials, STATUS_STYLE,
} from "./ui";
import { COUNTRIES } from "../../constants/countries";

/** A DATE from the API as "YYYY-MM-DD" for a date box. It arrives as a timestamp
 *  ("2026-09-20T18:30:00.000Z" is the 21st in Sri Lanka), so read it in local time. */
const dateInput = (v) => {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "14:00" / "14:00:00" -> minutes since midnight, or null when there is no time. */
const minutesOf = (t) => {
  if (!t) return null;
  const [h, m = "0"] = String(t).split(":");
  const n = Number(h) * 60 + Number(m);
  return Number.isFinite(n) ? n : null;
};
const prettyMinutes = (m) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

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

// Same idea as Delivery Partners' and Meal Plans' avatar palette — a stable
// hash of the type name always lands on the same color, without storing one.
const TYPE_PALETTE = [
  ["#EEF4FF", "#3538CD"], ["#ECFDF3", "#067647"], ["#FEF6EE", "#B93815"],
  ["#FDF2FA", "#C11574"], ["#F0F9FF", "#026AA2"], ["#FEF3F2", "#B42318"],
];
const typeColors = (name) => {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
};

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
      getGuests(),
      getAgents({ b_id: branchId }),
    ]).then(([g, a]) => { setGuests(g); setAgents(a); }).catch(() => {});
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
        <BookingFormModal
          branchId={branchId}
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

/**
 * The booking form — for a new reservation, or (with `initial`) for changing one.
 *
 * A guest who has already checked in has an open bill with the room charges on it,
 * so for them only the guest's details, the arrival time and the notes can change
 * here; the server refuses the rest for the same reason.
 */
export function BookingFormModal({ branchId, guests, agents, initial = null, onClose, onCreated }) {
  const isEdit = Boolean(initial);
  const inHouse = isEdit && initial.status === "checked_in";
  const knownGuest = isEdit ? (guests || []).find(g => g.guest_id === initial.guest_id) : null;
  const baseGuest = isEdit ? {
    full_name: knownGuest?.full_name ?? initial.guest_name ?? "",
    phone: knownGuest?.phone ?? initial.guest_phone ?? "",
    email: knownGuest?.email ?? initial.guest_email ?? "",
    country: knownGuest?.country ?? initial.guest_country ?? "",
    nationality: knownGuest?.nationality ?? initial.guest_nationality ?? "",
    passport_nic: knownGuest?.passport_nic ?? "",
  } : null;

  const [checkIn, setCheckIn]   = useState(isEdit ? dateInput(initial.check_in_date) : today());
  const [checkOut, setCheckOut] = useState(isEdit ? dateInput(initial.check_out_date) : ymd(addDays(new Date(), 1)));
  const [avail, setAvail]       = useState(null);
  const [searching, setSearching] = useState(false);

  const [picked, setPicked] = useState(() => {
    if (!isEdit) return [];
    // A specific-room row stays its own entry; type-only rows (room_id null —
    // a booking made without picking a room, assigned later at check-in)
    // collapse into one entry per type with a qty, matching how they're now
    // created and edited, rather than one indistinguishable entry per row.
    const specific = [], byType = new Map();
    for (const r of initial.rooms || []) {
      if (r.room_id) {
        specific.push({ room_type_id: r.room_type_id, type_name: r.type_name, room_id: r.room_id,
                         room_number: r.room_number, rate_per_night: Number(r.rate_per_night) || 0 });
      } else {
        const existing = byType.get(r.room_type_id);
        if (existing) existing.qty += 1;
        else byType.set(r.room_type_id, { room_type_id: r.room_type_id, type_name: r.type_name, room_id: null,
                                           qty: 1, rate_per_night: Number(r.rate_per_night) || 0 });
      }
    }
    return [...specific, ...byType.values()];
  }); // [{room_type_id,type_name,room_id,room_number,rate_per_night}] or [{...,room_id:null,qty}]
  const [adults, setAdults]     = useState(isEdit ? initial.adults : 2);
  const [children, setChildren] = useState(isEdit ? initial.children : 0);
  const [taxPct, setTaxPct]     = useState(isEdit ? Number(initial.tax_pct) : 0);
  // Set to the hotel's own rate once that is known — unless the desk has already typed one.
  const taxTouched = useRef(false);
  const [extras, setExtras]     = useState(isEdit ? Number(initial.extra_charges) || 0 : 0);
  const [discount, setDiscount] = useState(isEdit ? Number(initial.discount) || 0 : 0);
  const [advance, setAdvance]   = useState(isEdit ? Number(initial.paid_total) || 0 : 0);
  const [advanceMethod, setAdvanceMethod] = useState("cash");
  const [source, setSource]     = useState(isEdit ? initial.source : "phone");
  const [agentId, setAgentId]   = useState(isEdit && initial.agent_id ? String(initial.agent_id) : "");
  const [arrivalTime, setArrivalTime] = useState(isEdit ? (initial.arrival_time || "").slice(0, 5) : "");
  const [specialRequests, setSpecialRequests] = useState(isEdit ? initial.special_requests || "" : "");
  const [remarks, setRemarks]   = useState(isEdit ? initial.remarks || "" : "");

  const [existingGuest, setExistingGuest] = useState("");
  const [newGuestMode, setNewGuestMode]   = useState(true);
  const [guest, setGuest] = useState(baseGuest || { full_name: "", phone: "", email: "", country: "", nationality: "", passport_nic: "" });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nights = Math.max(nightsBetween(checkIn, checkOut), 0);

  const searchSeq = useRef(0);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const [droppedRooms, setDroppedRooms] = useState([]);
  const [houseTimes, setHouseTimes] = useState(null);

  const doSearch = async () => {
    if (!branchId || nightsBetween(checkIn, checkOut) < 1) return;
    const seq = ++searchSeq.current;
    setError(""); setSearching(true);
    try {
      const result = await getAvailability({
        b_id: branchId, check_in: checkIn, check_out: checkOut,
        // A reservation only ever books a room type, never a specific room —
        // so a room whose occupant is due out the day being searched can
        // count as available here, before the desk has actually checked them
        // out. Assigning a real room at check-in is a separate call, and
        // stays strict.
        count_turnovers: "1",
        ...(isEdit ? { exclude_booking: initial.booking_id } : {}),
      });
      if (seq !== searchSeq.current) return;   // the dates changed again while this was on its way
      setAvail(result);
      // A room picked for other dates may not be free for these ones.
      const byId = new Map();
      const byType = new Map();
      result.room_types.forEach(t => {
        byType.set(t.room_type_id, t);
        t.available_rooms.forEach(r => byId.set(r.room_id, { t, r }));
      });
      const dropped = [];
      const survivors = [];
      for (const x of pickedRef.current) {
        if (x.room_id) {
          // A specific room picked for other dates may not be free for these ones.
          const hit = byId.get(x.room_id);
          if (!hit) { dropped.push(`Room ${x.room_number}`); continue; }
          const { t, r } = hit;
          survivors.push({
            ...x,
            included_guests: t.included_guests == null ? null : Number(t.included_guests),
            max_adults: t.max_adults == null ? null : Number(t.max_adults),
            max_children: t.max_children == null ? null : Number(t.max_children),
            extra_adult_rate: Number(t.extra_adult_rate) || 0,
            extra_child_rate: Number(t.extra_child_rate) || 0,
            leaving: r.leaving_that_day || null,
          });
        } else {
          // A type-only reservation shrinks to however many of the type are
          // still free for the new dates, rather than vanishing outright.
          const t = byType.get(x.room_type_id);
          const cap = t ? t.available_rooms.length : 0;
          if (cap <= 0) { dropped.push(`${x.qty}× ${x.type_name}`); continue; }
          const qty = Math.min(x.qty, cap);
          if (qty < x.qty) dropped.push(`${x.qty - qty}× ${x.type_name}`);
          survivors.push({
            ...x, qty,
            included_guests: t.included_guests == null ? null : Number(t.included_guests),
            max_adults: t.max_adults == null ? null : Number(t.max_adults),
            max_children: t.max_children == null ? null : Number(t.max_children),
            extra_adult_rate: Number(t.extra_adult_rate) || 0,
            extra_child_rate: Number(t.extra_child_rate) || 0,
          });
        }
      }
      setDroppedRooms(dropped);
      setPicked(survivors);
    } catch (err) {
      if (seq === searchSeq.current) setError(err?.response?.data?.message || "Could not load availability");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // The list follows the dates. It used to be fetched once, when the form opened
  // (today to tomorrow), and again only on the button — so after the dates were
  // changed the screen went on showing the old answer, "Fully booked" for a room
  // that was free on the new dates.
  useEffect(() => {
    if (!branchId || nights < 1 || inHouse) return undefined;
    const t = setTimeout(doSearch, avail ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [branchId, checkIn, checkOut]);

  // Check-in and check-out times, for the note about same-day hand-overs.
  useEffect(() => {
    // Only the hotel's own saved times are quoted; until then the note stays general.
    getStayPolicy().then(p => {
      if (!isEdit && !taxTouched.current) setTaxPct(Number(p.default_tax_pct) || 0);
      return p;
    }).then(p => setHouseTimes(p.policy_saved
      ? { in: p.check_in_pretty, out: p.check_out_pretty,
          inMin: minutesOf(p.check_in_time), outMin: minutesOf(p.check_out_time) }
      : null)).catch(() => {});
  }, []);

  // Results that belong to other dates (or are still arriving) are shown faded and cannot be clicked.
  const stale = searching || (avail && (avail.check_in !== checkIn || avail.check_out !== checkOut));

  const removeRoom = (roomId) => setPicked(p => p.filter(x => x.room_id !== roomId));
  const setRate = (roomId, rate) =>
    setPicked(p => p.map(x => x.room_id === roomId ? { ...x, rate_per_night: rate } : x));

  // Reserve N rooms of a type without picking which ones — the room is
  // assigned later, at check-in. `cap` is how many of the type are still
  // free for these dates minus whatever's already individually picked.
  const incType = (type, cap) => setPicked(p => {
    const existing = p.find(x => !x.room_id && x.room_type_id === type.room_type_id);
    if (existing) {
      if (existing.qty >= cap) return p;
      return p.map(x => x === existing ? { ...x, qty: x.qty + 1 } : x);
    }
    if (cap < 1) return p;
    return [...p, {
      room_id: null, room_type_id: type.room_type_id, type_name: type.type_name, qty: 1,
      rate_per_night: Number(type.base_rate) || 0,
      included_guests: type.included_guests == null ? null : Number(type.included_guests),
      max_adults: type.max_adults == null ? null : Number(type.max_adults),
      max_children: type.max_children == null ? null : Number(type.max_children),
      extra_adult_rate: Number(type.extra_adult_rate) || 0,
      extra_child_rate: Number(type.extra_child_rate) || 0,
    }];
  });
  const decType = (roomTypeId) => setPicked(p => p
    .map(x => (!x.room_id && x.room_type_id === roomTypeId) ? { ...x, qty: x.qty - 1 } : x)
    .filter(x => x.room_id || x.qty > 0));
  const setTypeRate = (roomTypeId, rate) =>
    setPicked(p => p.map(x => (!x.room_id && x.room_type_id === roomTypeId) ? { ...x, rate_per_night: rate } : x));

  // A specific-room entry sends one line; a type-only entry expands into
  // `qty` identical lines with no room_id, exactly like createBooking/
  // updateBooking already expect.
  const roomsPayload = (list) => list.flatMap(p => p.room_id
    ? [{ room_id: p.room_id, room_type_id: p.room_type_id, rate_per_night: p.rate_per_night }]
    : Array.from({ length: p.qty }, () => ({ room_type_id: p.room_type_id, rate_per_night: p.rate_per_night })));

  // A picked entry is either one specific room (qty implicitly 1) or a
  // type-only reservation for `qty` rooms of that type, room TBD at
  // check-in. Capacity/seating/pricing all work per physical room, so
  // expand type-only entries into that many identical virtual slots.
  const expanded = useMemo(() =>
    picked.flatMap(p => Array.from({ length: p.qty ?? 1 }, () => p))
  , [picked]);
  const pickedRoomCount = expanded.length;

  // How many people the selected rooms hold, and how much of the bill can be
  // given away — the same two ceilings the server enforces, shown while typing
  // rather than thrown back after Create.
  const capacity = expanded.reduce(
    (s, r) => s + (r.max_adults == null ? 0 : Number(r.max_adults))
                + (r.max_children == null ? 0 : Number(r.max_children)), 0);
  const people   = numOr(adults, 0) + numOr(children, 0);

  // The same seating the server does, so the desk sees the extra-guest charge
  // while it types rather than after Create.
  const seated = useMemo(() => {
    const seats = expanded.map(r => ({ ...r, seatAdults: 0, seatChildren: 0 }));
    if (!seats.length) return seats;
    let a = numOr(adults, 0), c = numOr(children, 0);
    for (const seat of seats) {
      if (a <= 0) break;
      const room = seat.max_adults == null ? a : Math.max(0, Number(seat.max_adults));
      const take = Math.min(a, room); seat.seatAdults += take; a -= take;
    }
    for (const seat of seats) {
      if (c <= 0) break;
      const room = seat.max_children == null ? c : Math.max(0, Number(seat.max_children));
      const take = Math.min(c, room); seat.seatChildren += take; c -= take;
    }
    if (a > 0 || c > 0) {
      const last = seats[seats.length - 1];
      last.seatAdults += a; last.seatChildren += c;
    }
    return seats;
  }, [expanded, adults, children]);

  const extraGuests = useMemo(() => {
    let amount = 0, extraAdults = 0, extraChildren = 0;
    for (const r of seated) {
      if (r.included_guests == null) continue;
      const included = Math.max(0, Number(r.included_guests));
      const aIn = Math.min(r.seatAdults, included);
      const cIn = Math.min(r.seatChildren, included - aIn);
      const ea = r.seatAdults - aIn, ec = r.seatChildren - cIn;
      extraAdults += ea; extraChildren += ec;
      amount += (ea * Number(r.extra_adult_rate || 0) + ec * Number(r.extra_child_rate || 0)) * nights;
    }
    return { amount: +amount.toFixed(2), extraAdults, extraChildren };
  }, [seated, nights]);

  const totals = useMemo(() => {
    const room = expanded.reduce((s, r) => s + Number(r.rate_per_night || 0) * nights, 0);
    const tax = room * (Number(taxPct) || 0) / 100;
    const beforeDiscount = room + tax + extraGuests.amount + numOr(extras);
    const grand = beforeDiscount - numOr(discount);
    return { room, tax, guests: extraGuests.amount, beforeDiscount, grand,
             balance: grand - numOr(advance) };
  }, [expanded, nights, adults, children, taxPct, extras, discount, advance, extraGuests]);

  // Does the arrival time make sense for the rooms picked? Advice, never a block:
  // the desk may well have arranged an early check-in, or a room that is already
  // clean. Nothing was checking it at all, so an 8 AM arrival went into a room
  // whose guest was not due to leave until 11.
  const arrivalNotes = useMemo(() => {
    const at = minutesOf(arrivalTime);
    if (at == null) return [];
    const notes = [];
    for (const r of picked) {
      if (!r.leaving) continue;
      if (houseTimes?.outMin != null) {
        if (at < houseTimes.outMin) {
          notes.push({ level: "warn", text: `Room ${r.room_number} will still be occupied at ${prettyMinutes(at)}: ${r.leaving.guest_name} checks out by ${houseTimes.out}. Ask this guest to arrive after that, or pick another room.` });
        }
      } else {
        notes.push({ level: "warn", text: `Room ${r.room_number} has a guest checking out that morning (${r.leaving.guest_name}). Make sure they have left before this guest arrives at ${prettyMinutes(at)}.` });
      }
    }
    if (!notes.length && houseTimes?.inMin != null && at < houseTimes.inMin) {
      notes.push({ level: "info", text: `${prettyMinutes(at)} is earlier than your check-in time (${houseTimes.in}). The room may not be ready yet — arrange an early check-in, or let the guest know they may have to wait.` });
    }
    return notes;
  }, [arrivalTime, picked, houseTimes]);

  // Over the nominal occupancy is the desk's call, not ours — a cot or a shared
  // bed is an everyday answer. Say so, and let them book it.
  const overCapacity = capacity > 0 && people > capacity;

  const overDiscount = numOr(discount) > totals.beforeDiscount + 0.001;
  // While the discount is out of range the grand total is meaningless (it goes
  // negative), so judging the advance against it would flag even an advance of 0.
  const overAdvance  = !isEdit && !overDiscount && numOr(advance) > totals.grand + 0.001;

  const submitEdit = async () => {
    if (!guest.full_name.trim()) { setError("Guest name is required."); return; }
    if (guest.email.trim() && !EMAIL_RE.test(guest.email.trim())) { setError("That doesn't look like an email address."); return; }
    if (!inHouse) {
      if (!picked.length)  { setError("Select at least one room."); return; }
      if (nights < 1)      { setError("Check-out must be after check-in."); return; }
      if (nights > 365)    { setError("A booking cannot run longer than 365 nights."); return; }
      if (numOr(adults, 0) < 1) { setError("At least one adult is required."); return; }
      if (source === "agent" && !agentId) { setError("Choose the agent this booking came through."); return; }
      if (checkIn !== dateInput(initial.check_in_date) && checkIn < today()) {
        setError("Check-in can't be moved to a date that has already passed."); return;
      }
      if (overDiscount) { setError(`Discount cannot be more than ${money(totals.beforeDiscount)}.`); return; }
    }

    setSubmitting(true);
    try {
      // The guest's own details first: if this fails nothing else has changed.
      const changed = {};
      GUEST_FIELDS.forEach(f => { if ((guest[f.k] || "") !== (baseGuest[f.k] || "")) changed[f.k] = guest[f.k]; });
      if (Object.keys(changed).length) await updateGuest(initial.guest_id, changed);

      try {
        const saved = await updateBooking(initial.booking_id, inHouse
          ? { arrival_time: arrivalTime, special_requests: specialRequests, remarks }
          : {
              check_in_date: checkIn, check_out_date: checkOut,
              adults: numOr(adults, 1), children: numOr(children, 0),
              tax_pct: numOr(taxPct, 0), extra_charges: numOr(extras), discount: numOr(discount),
              source, agent_id: source === "agent" ? agentId : "",
              arrival_time: arrivalTime, special_requests: specialRequests, remarks,
              rooms: roomsPayload(picked),
            });
        onCreated(saved);
      } catch (err) {
        setError(`${Object.keys(changed).length ? "The guest's details were updated, but the booking wasn't saved: " : ""}${
          err?.response?.data?.message || "Could not save the booking"}`);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Could not update the guest's details");
    } finally { setSubmitting(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (isEdit) { await submitEdit(); return; }
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
        meal_plan_id: undefined,
        arrival_time: arrivalTime || undefined,
        special_requests: specialRequests || undefined,
        remarks: remarks || undefined,
        tax_pct: numOr(taxPct, 0),
        extra_charges: numOr(extras), discount: numOr(discount),
        advance_payment: numOr(advance), advance_method: advanceMethod,
        rooms: roomsPayload(picked),
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
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#1E293B" }}>
            {isEdit ? `Edit Booking ${initial.booking_ref}` : "New Reservation"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        {inHouse && (
          <div style={{ ...errorBox, background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1E40AF" }}>
            This guest has checked in, so the bill is already open. Here you can correct the guest's details, the
            arrival time and the notes. To add a night or a charge, use the bill on the booking page.
          </div>
        )}

        <form onSubmit={submit}>
          <datalist id="guest-countries">
            {COUNTRIES.map(c => <option key={c} value={c} />)}
          </datalist>

          <Section title="Stay Dates & Guests">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, alignItems: "end" }}>
              <label style={label}>Check-In
                <input type="date" value={checkIn} min={isEdit ? undefined : today()} disabled={inHouse}
                  onChange={e => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(ymd(addDays(new Date(e.target.value), 1))); }}
                  style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Check-Out
                <input type="date" value={checkOut} min={ymd(addDays(new Date(checkIn), 1))} disabled={inHouse}
                  onChange={e => setCheckOut(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <div style={{ padding: "9px 14px", background: "#EFF6FF", borderRadius: 8, fontWeight: 700, color: "#1565C0", fontSize: 13 }}>
                {nights} night{nights === 1 ? "" : "s"}
              </div>
              <button type="button" onClick={doSearch} disabled={searching || inHouse} style={btn("primary")}>
                {searching ? "Checking…" : "Refresh"}
              </button>
            </div>

            {/* Party size belongs here, not below the room list: it is what makes a
                room suitable, so the cashier has to set it before choosing one. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12, marginTop: 12, alignItems: "end" }}>
              <label style={label}>Adults
                <input type="number" min={1} max={99} step="1" required value={adults} disabled={inHouse}
                  onChange={e => setAdults(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <label style={label}>Children
                <input type="number" min={0} max={99} step="1" required value={children} disabled={inHouse}
                  onChange={e => setChildren(e.target.value)} style={{ ...input, marginTop: 4 }} />
              </label>
              <div style={{ fontSize: 12, color: "#64748B", paddingBottom: 10 }}>
                Booking for <strong style={{ color: "#1E293B" }}>{people} guest{people === 1 ? "" : "s"}</strong>
                {pickedRoomCount > 0 && (
                  <span style={{ color: overCapacity ? "#B45309" : "#059669", fontWeight: 600 }}>
                    {" · "}{pickedRoomCount} room{pickedRoomCount === 1 ? "" : "s"} selected, holding up to {capacity}
                    {overCapacity ? " — above that" : " ✓"}
                  </span>
                )}
              </div>
            </div>
          </Section>

          {droppedRooms.length > 0 && (
            <div style={{ ...errorBox, background: "#FFFBEB", borderColor: "#FDE68A", color: "#92400E" }}>
              {droppedRooms.length === 1 ? `${droppedRooms[0]} was` : `${droppedRooms.join(", ")} were`} taken off
              your selection — {droppedRooms.length === 1 ? "it isn't" : "they aren't"} free for the new dates. Pick again below.
            </div>
          )}

          {avail && !inHouse && (
            <Section title="Available Rooms">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 12, color: "#64748B" }}>
                <span>
                  For <strong style={{ color: "#1E293B" }}>{dmy(avail.check_in)} → {dmy(avail.check_out)}</strong>
                  {" "}({avail.nights} night{avail.nights === 1 ? "" : "s"})
                </span>
                {stale && <span style={{ color: "#B45309", fontWeight: 600 }}>Updating for the new dates…</span>}
              </div>
              {avail.room_types.some(t => t.available_rooms.some(r => r.leaving_that_day)) && (
                <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#F0F9FF",
                              border: "1px solid #BAE6FD", color: "#0C4A6E", fontSize: 12, lineHeight: 1.5 }}>
                  <strong>Same-day hand-over.</strong> A room marked “checks out that morning” is free for this stay:
                  {houseTimes ? ` guests leave by ${houseTimes.out} and the next guest arrives from ${houseTimes.in}.` : " the previous guest leaves that morning and the next one arrives that afternoon."}
                </div>
              )}
              <div style={{ opacity: stale ? 0.5 : 1, pointerEvents: stale ? "none" : "auto", transition: "opacity .15s" }}>
              {avail.room_types.every(t => t.available_rooms.length === 0) ? (
                <div style={{ padding: 20, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                  No rooms free for those dates.
                </div>
              ) : avail.room_types.map(t => {
                // What the room takes, adults and children counted separately now.
                const holdsAdults = t.max_adults == null ? null : Number(t.max_adults);
                const holdsKids   = t.max_children == null ? null : Number(t.max_children);
                const holds = (holdsAdults ?? 0) + (holdsKids ?? 0);
                // How many of this type it would take to seat the party. Never
                // disable a "small" type — two Standard Doubles is a perfectly
                // good answer for four guests.
                const needed = holds > 0 ? Math.ceil(people / holds) : 0;
                const [bg, fg] = typeColors(t.type_name);
                const pickedSpecific = picked.filter(p => p.room_id && p.room_type_id === t.room_type_id).length;
                const typeOnly = picked.find(p => !p.room_id && p.room_type_id === t.room_type_id);
                const cap = t.available_rooms.length - pickedSpecific;
                // Rooms already free that day plus rooms a same-day checkout will
                // free up — both are bookable now, just at different times.
                const sameDayCount = t.available_rooms.filter(r => r.leaving_that_day).length;
                const full = t.available_rooms.length === 0;
                return (
                <div key={t.room_type_id}
                  style={{ ...card, padding: 16, marginBottom: 12, opacity: full ? 0.8 : 1 }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color: fg,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {initials(t.type_name)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#101828" }}>{t.type_name}</div>
                          <div style={{ fontSize: 12, color: "#667085", marginTop: 1 }}>
                            {(() => {
                              const who = [
                                holdsAdults ? `${holdsAdults} adult${holdsAdults === 1 ? "" : "s"}` : null,
                                holdsKids ? `${holdsKids} child${holdsKids === 1 ? "" : "ren"}` : null,
                              ].filter(Boolean).join(" + ");
                              const covers = t.included_guests == null ? "rate covers the room" : `rate covers ${t.included_guests}`;
                              return who ? `Takes ${who} · ${covers}` : covers;
                            })()}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, color: "#1565C0", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {money(t.base_rate)}<span style={{ fontWeight: 400, fontSize: 11, color: "#94A3B8" }}>/night</span>
                        </div>
                      </div>

                      {t.description && (
                        <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>{t.description}</div>
                      )}

                      {Array.isArray(t.amenities) && t.amenities.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                          {t.amenities.map(a => (
                            <span key={a} style={{ fontSize: 10.5, color: "#475569", background: "#F1F5F9",
                                                   border: "1px solid #E2E8F0", borderRadius: 20, padding: "2px 9px" }}>
                              {a}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {needed === 1 && <span style={badge({ bg: "#ECFDF3", fg: "#067647" })}>Fits all {people}</span>}
                        {needed > 1 && <span style={badge({ bg: "#FFFAEB", fg: "#B54708" })}>{people} guests needs {needed} rooms</span>}
                        {full ? (
                          <span style={badge({ bg: "#FEF3F2", fg: "#B42318" })}>
                            Fully booked ({t.total_rooms} room{t.total_rooms === 1 ? "" : "s"})
                          </span>
                        ) : sameDayCount > 0 ? (
                          <span style={badge({ bg: "#EFF8FF", fg: "#175CD3" })}>
                            {t.available_rooms.length} of {t.total_rooms} free · {sameDayCount} more once check-out is done
                          </span>
                        ) : (
                          <span style={badge({ bg: "#ECFDF3", fg: "#067647" })}>
                            {t.available_rooms.length} of {t.total_rooms} free
                          </span>
                        )}
                      </div>

                      {/* A specific room is never picked here — only how many of this
                          type, and at what rate. Which physical room the guest gets
                          is a check-in decision, made when they are actually here,
                          not something reserved days or months in advance. */}
                      {!full && !inHouse && (
                        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8FAFC",
                                        border: "1px solid #E2E8F0", borderRadius: 10, padding: "4px 6px" }}>
                            <button type="button" onClick={() => decType(t.room_type_id)} disabled={!typeOnly}
                              style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff",
                                       fontSize: 15, fontWeight: 700, color: "#475569",
                                       cursor: typeOnly ? "pointer" : "default", opacity: typeOnly ? 1 : 0.4 }}>−</button>
                            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{typeOnly?.qty || 0}</span>
                            <button type="button" onClick={() => incType(t, cap)} disabled={!(typeOnly ? typeOnly.qty < cap : cap > 0)}
                              style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff",
                                       fontSize: 15, fontWeight: 700, color: "#475569",
                                       cursor: (typeOnly ? typeOnly.qty < cap : cap > 0) ? "pointer" : "default",
                                       opacity: (typeOnly ? typeOnly.qty < cap : cap > 0) ? 1 : 0.4 }}>+</button>
                          </div>
                          <span style={{ fontSize: 11.5, color: "#94A3B8" }}>rooms of this type</span>
                          {typeOnly && (
                            <label style={{ ...label, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>Rate/night
                              <input type="number" min={0} step="0.01" value={typeOnly.rate_per_night}
                                onChange={e => setTypeRate(t.room_type_id, e.target.value)}
                                style={{ ...input, width: 90, padding: "4px 8px", fontSize: 12 }} />
                            </label>
                          )}
                        </div>
                      )}

                      {/* Category first, reasons on demand — the desk doesn't need
                          a room-by-room breakdown to decide whether to book this
                          type, only if they go looking for it. */}
                      {(t.unavailable_rooms || []).length > 0 && (
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ cursor: "pointer", fontSize: 11.5, color: "#64748B", fontWeight: 600 }}>
                            Why {t.unavailable_rooms.length} {t.unavailable_rooms.length === 1 ? "room isn't" : "rooms aren't"} free
                          </summary>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                            {t.unavailable_rooms.map(r => (
                              <span key={r.room_id} style={{ fontSize: 11.5, color: "#94A3B8" }}>
                                Room {r.room_number} is taken
                                {r.blocked_by
                                  ? (r.blocked_by.status === "checked_in"
                                    // Still in the room: they keep it until the desk checks them out,
                                    // whatever date they were due to leave.
                                    ? ` — ${r.blocked_by.guest_name} is in the room (due out ${dmy(r.blocked_by.due_out)}); it is free once they are checked out`
                                    : ` — ${r.blocked_by.guest_name}, ${dmy(r.blocked_by.check_in)} → ${dmy(r.blocked_by.check_out)}`)
                                  : ""}
                              </span>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
              </div>
            </Section>
          )}

          {picked.length > 0 && (
            <Section title="Selected Rooms & Rates">
              {picked.map(p => (
                <div key={p.room_id ?? `type-${p.room_type_id}`} style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 12,
                                              alignItems: "center", marginBottom: 8, padding: "10px 14px",
                                              background: "#F8FAFC", borderRadius: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    {p.room_id ? (
                      <><strong>Room {p.room_number}</strong><span style={{ color: "#94A3B8" }}> · {p.type_name}</span></>
                    ) : (
                      <><strong>{p.qty}× {p.type_name}</strong><span style={{ color: "#94A3B8" }}> · room assigned at check-in</span></>
                    )}
                  </div>
                  <label style={{ ...label, fontSize: 11 }}>Rate / night
                    <input type="number" min={0} step="0.01" value={p.rate_per_night} disabled={inHouse}
                      onChange={e => p.room_id ? setRate(p.room_id, e.target.value) : setTypeRate(p.room_type_id, e.target.value)}
                      style={{ ...input, marginTop: 2, padding: "6px 10px", fontSize: 13 }} />
                  </label>
                  {inHouse ? <span />
                    : <button type="button" onClick={() => p.room_id ? removeRoom(p.room_id) : decType(p.room_type_id)} style={btn("danger")}>
                        {p.room_id ? "Remove" : (p.qty > 1 ? "Remove one" : "Remove")}
                      </button>}
                </div>
              ))}
            </Section>
          )}

          <Section title={isEdit ? "Guest details" : "Guest"}>
            {isEdit && (
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
                These are the guest's own details, so a correction here shows on all of their bookings.
              </div>
            )}
            <div style={{ display: isEdit ? "none" : "flex", gap: 16, marginBottom: 12 }}>
              {[[true, "New guest"], [false, "Existing guest"]].map(([mode, txt]) => (
                <label key={txt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#475569" }}>
                  <input type="radio" checked={newGuestMode === mode} onChange={() => setNewGuestMode(mode)} />
                  {txt}
                </label>
              ))}
            </div>
            {newGuestMode || isEdit ? (
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
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
            {arrivalNotes.map((n, i) => (
              <div key={i} role="status" style={{
                marginTop: 10, padding: "9px 12px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
                background: n.level === "warn" ? "#FFFBEB" : "#F0F9FF",
                border: `1px solid ${n.level === "warn" ? "#FDE68A" : "#BAE6FD"}`,
                color: n.level === "warn" ? "#92400E" : "#0C4A6E",
              }}>
                {n.level === "warn" ? "⚠ " : "ℹ "}{n.text}
              </div>
            ))}
          </Section>

          {!inHouse && (
          <Section title="Charges">
            <div style={{ display: "grid", gridTemplateColumns: isEdit ? "repeat(3,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
              <label style={label}>Tax %
                <input type="number" min={0} max={100} step="0.01" required value={taxPct}
                  onChange={e => { taxTouched.current = true; setTaxPct(e.target.value); }} style={{ ...input, marginTop: 4 }} />
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
              {!isEdit && (
              <label style={label}>Advance Payment
                <input type="number" min={0} max={MAX_MONEY} step="0.01" required value={advance}
                  onChange={e => setAdvance(e.target.value)}
                  style={{ ...input, marginTop: 4, ...(overAdvance ? overStyle : null) }} />
                {overAdvance && <span style={hint}>Grand total is only {money(totals.grand)}</span>}
              </label>
              )}
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
              {/* One line per room showing its own arithmetic. "Total Room Charges
                  24,000" for a 12,000 room is correct but unreadable — nothing on
                  the line said whether the doubling was nights or rooms. */}
              {picked.map(p => (
                <div key={p.room_id ?? `type-${p.room_type_id}`} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: "#64748B" }}>
                  <span>
                    {p.room_id ? `Room ${p.room_number}` : `${p.qty}× ${p.type_name}`}
                    <span style={{ color: "#94A3B8" }}>
                      {" · "}{nights} night{nights === 1 ? "" : "s"} × {money(p.rate_per_night)}{!p.room_id && p.qty > 1 ? ` × ${p.qty}` : ""}
                    </span>
                  </span>
                  <span style={{ color: "#1E293B", fontWeight: 600 }}>
                    {money(numOr(p.rate_per_night) * nights * (p.qty ?? 1))}
                  </span>
                </div>
              ))}

              {[
                ...(pickedRoomCount > 1 ? [["Total Room Charges", money(totals.room), "#1E293B"]] : []),
                [`Room Charges Tax (${taxPct}%)`, money(totals.tax), "#1E293B"],
                ...(totals.guests ? [[
                  `Extra guests (${[extraGuests.extraAdults ? `${extraGuests.extraAdults} adult${extraGuests.extraAdults === 1 ? "" : "s"}` : null,
                                    extraGuests.extraChildren ? `${extraGuests.extraChildren} child${extraGuests.extraChildren === 1 ? "" : "ren"}` : null]
                                    .filter(Boolean).join(", ")} × ${nights} night${nights === 1 ? "" : "s"})`,
                  money(totals.guests), "#1E293B"]] : []),

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
                <span>{isEdit ? "Balance Due" : "Amount Due at Check-In"}</span><span>{money(Math.max(totals.balance, 0))}</span>
              </div>
              {isEdit && totals.balance < -0.005 && (
                <div style={{ padding: "6px 0 0", fontSize: 12.5, color: "#B45309" }}>
                  The guest has already paid {money(advance)}, which is {money(-totals.balance)} more than the new total.
                  That much is due back to them — record it as a refund from the booking page.
                </div>
              )}
              {isEdit && (
                <div style={{ padding: "6px 0 0", fontSize: 11.5, color: "#94A3B8" }}>
                  Payments already taken are left as they are.
                </div>
              )}
            </div>
          </Section>
          )}

          {overCapacity && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12, padding: "11px 14px",
                          background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8,
                          fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>⚠</span>
              <span>
                <strong>{people} guests</strong> in {pickedRoomCount === 1 ? "a room that normally holds" : "rooms that normally hold"}{" "}
                <strong>{capacity}</strong>. Fine for young children sharing — just make sure the extra bedding is arranged.
                You can still create this booking.
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 12 }}>Cancel</button>
            <button type="submit" disabled={submitting} style={{ ...btn("primary"), flex: 2, padding: 12, opacity: submitting ? 0.7 : 1 }}>
              {submitting ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Changes" : "Create Booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
