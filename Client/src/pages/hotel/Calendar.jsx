import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getRooms, getBookings } from "../../services/api";
import { connectSocket } from "../../services/socket";
import { card, btn, input, errorBox, money, dmy, ymd, today, addDays } from "./ui";

const CELL = 44;      // px per night column
const LABEL_W = 168;  // room-name gutter

const BAR = {
  tentative:  { bg: "#FDE68A", fg: "#78350F", edge: "#F59E0B" },
  confirmed:  { bg: "#BFDBFE", fg: "#1E3A8A", edge: "#3B82F6" },
  checked_in: { bg: "#A7F3D0", fg: "#064E3B", edge: "#10B981" },
};

export default function Calendar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [start, setStart] = useState(today());
  const [span, setSpan] = useState(14);
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hover, setHover] = useState(null);
  const [live, setLive] = useState(false);

  const days = useMemo(
    () => Array.from({ length: span }, (_, i) => ymd(addDays(new Date(start), i))),
    [start, span]
  );
  const rangeEnd = useMemo(() => ymd(addDays(new Date(start), span)), [start, span]);

  const load = async (silent = false) => {
    if (!branchId) return;
    if (!silent) setLoading(true);
    try {
      const [r, b] = await Promise.all([
        getRooms({ b_id: branchId }),
        // Anything overlapping the window: starts before it ends, ends after it starts
        getBookings({ b_id: branchId, from: start, to: rangeEnd }),
      ]);
      setRooms(r);
      setBookings(b.filter(x => ["tentative", "confirmed", "checked_in"].includes(x.status)));
      setError("");
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load the calendar");
    } finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, start, span]);

  // Live: any booking or order event anywhere refreshes the chart for everyone.
  const timer = useRef(null);
  useEffect(() => {
    const socket = connectSocket();
    const bump = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => load(true), 600);
    };
    const evts = ["order:new", "order:created", "order:updated", "booking:changed"];
    evts.forEach(e => socket.on(e, bump));
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    setLive(socket.connected);
    return () => {
      evts.forEach(e => socket.off(e, bump));
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line
  }, [branchId, start, span]);

  // Lay each booking out as a bar: which room row, which column, how many nights
  const barsByRoom = useMemo(() => {
    const map = {};
    bookings.forEach(b => {
      const ci = String(b.check_in_date).slice(0, 10);
      const co = String(b.check_out_date).slice(0, 10);
      (b.rooms || []).forEach(br => {
        if (!br.room_id) return;
        const startIdx = days.indexOf(ci);
        const endIdx   = days.indexOf(co);
        // Clip to the visible window so bookings running off either edge still show
        const from = startIdx >= 0 ? startIdx : (ci < days[0] ? 0 : null);
        const to   = endIdx   >= 0 ? endIdx   : (co > days[days.length - 1] ? days.length : null);
        if (from === null || to === null || to <= from) return;
        (map[br.room_id] ||= []).push({
          booking: b, from, width: to - from,
          clippedLeft: ci < days[0], clippedRight: co > days[days.length - 1],
        });
      });
    });
    return map;
  }, [bookings, days]);

  const gridW = LABEL_W + days.length * CELL;
  const isToday = (d) => d === today();
  const isWeekend = (d) => [0, 6].includes(new Date(d + "T00:00:00").getDay());

  return (
    <AppShell title="Calendar">
      {error && <div style={errorBox}>{error}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setStart(ymd(addDays(new Date(start), -span)))} style={btn("ghost")}>‹ Back</button>
        <button onClick={() => setStart(today())} style={btn("ghost")}>Today</button>
        <button onClick={() => setStart(ymd(addDays(new Date(start), span)))} style={btn("ghost")}>Next ›</button>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ ...input, width: 155 }} />
        <select value={span} onChange={e => setSpan(Number(e.target.value))} style={{ ...input, width: 110 }}>
          {[7, 14, 30].map(n => <option key={n} value={n}>{n} nights</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "#10B981" : "#CBD5E1" }} />
          {live ? "Live" : "Offline"}
        </span>
        <button onClick={() => navigate("/hotel/bookings?new=1")} style={btn("primary")}>+ New Booking</button>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12, color: "#64748B", flexWrap: "wrap" }}>
        {Object.entries(BAR).map(([k, s]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 12, background: s.bg, border: `1px solid ${s.edge}`, borderRadius: 3 }} />
            {k === "checked_in" ? "In house" : k === "confirmed" ? "Confirmed" : "Tentative"}
          </span>
        ))}
        <span style={{ color: "#94A3B8" }}>Click a bar to open the booking · click an empty cell to start one</span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading calendar…</div>
      ) : rooms.length === 0 ? (
        <div style={{ ...card, padding: 48, textAlign: "center", color: "#94A3B8" }}>
          No rooms yet. Add them under Hotel → Rooms &amp; Housekeeping.
        </div>
      ) : (
        <div style={{ ...card, overflow: "auto", position: "relative" }}>
          <div style={{ minWidth: gridW }}>

            {/* Date header */}
            <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#F8FAFC",
                          borderBottom: "1px solid #E2E8F0" }}>
              <div style={{ width: LABEL_W, flexShrink: 0, padding: "8px 14px", fontSize: 11, fontWeight: 700,
                            color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em",
                            position: "sticky", left: 0, background: "#F8FAFC", zIndex: 4,
                            borderRight: "1px solid #E2E8F0" }}>
                Room
              </div>
              {days.map(d => {
                const dt = new Date(d + "T00:00:00");
                return (
                  <div key={d} style={{
                    width: CELL, flexShrink: 0, textAlign: "center", padding: "6px 0",
                    background: isToday(d) ? "#DBEAFE" : isWeekend(d) ? "#F1F5F9" : "transparent",
                    borderLeft: "1px solid #E2E8F0",
                  }}>
                    <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase" }}>
                      {dt.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: isToday(d) ? 700 : 500,
                                  color: isToday(d) ? "#1565C0" : "#1E293B" }}>
                      {dt.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* One row per room */}
            {rooms.map((room, ri) => (
              <div key={room.room_id} style={{ display: "flex", position: "relative",
                                               borderBottom: ri < rooms.length - 1 ? "1px solid #F1F5F9" : "none",
                                               height: CELL }}>
                <div style={{ width: LABEL_W, flexShrink: 0, padding: "6px 14px", position: "sticky", left: 0,
                              background: "#fff", zIndex: 2, borderRight: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{room.room_number}</div>
                  <div style={{ fontSize: 10, color: "#94A3B8", whiteSpace: "nowrap", overflow: "hidden",
                                textOverflow: "ellipsis" }}>{room.type_name}</div>
                </div>

                {/* Empty night cells — clicking one starts a booking on that date */}
                {days.map(d => (
                  <div key={d}
                    onClick={() => navigate(`/hotel/bookings?new=1&date=${d}&room=${room.room_id}`)}
                    title={`${room.room_number} · ${dmy(d)} — click to book`}
                    style={{
                      width: CELL, flexShrink: 0, borderLeft: "1px solid #F1F5F9", cursor: "pointer",
                      background: isToday(d) ? "#EFF6FF" : isWeekend(d) ? "#FAFBFC" : "transparent",
                    }} />
                ))}

                {/* Booking bars float above the cells */}
                {(barsByRoom[room.room_id] || []).map((bar, i) => {
                  const s = BAR[bar.booking.status] || BAR.confirmed;
                  return (
                    <div key={i}
                      onClick={() => navigate(`/hotel/bookings/${bar.booking.booking_id}`)}
                      onMouseEnter={() => setHover(bar.booking)}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        position: "absolute", top: 5, height: CELL - 12,
                        left: LABEL_W + bar.from * CELL + 3,
                        width: bar.width * CELL - 6,
                        background: s.bg, color: s.fg,
                        border: `1px solid ${s.edge}`,
                        borderRadius: 6,
                        borderTopLeftRadius: bar.clippedLeft ? 0 : 6,
                        borderBottomLeftRadius: bar.clippedLeft ? 0 : 6,
                        borderTopRightRadius: bar.clippedRight ? 0 : 6,
                        borderBottomRightRadius: bar.clippedRight ? 0 : 6,
                        display: "flex", alignItems: "center", padding: "0 8px",
                        fontSize: 11, fontWeight: 600, cursor: "pointer", zIndex: 1,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                      {bar.booking.guest_name || bar.booking.booking_ref}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Hover card */}
          {hover && (
            <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 50, width: 264,
                          background: "#fff", borderRadius: 12, padding: 16,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.16)", border: "1px solid #E2E8F0" }}>
              <div style={{ fontWeight: 700, color: "#1E293B", fontSize: 14 }}>{hover.guest_name || "Guest"}</div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>{hover.booking_ref}</div>
              {[
                ["Stay", `${dmy(hover.check_in_date)} → ${dmy(hover.check_out_date)}`],
                ["Nights", hover.nights],
                ["Guests", `${hover.adults} adult(s)${hover.children ? `, ${hover.children} child` : ""}`],
                ["Plan", hover.plan_name || "Room Only"],
                ["Total", money(hover.grand_total)],
                ["Paid", money(hover.paid_total)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                  <span style={{ color: "#64748B" }}>{k}</span>
                  <span style={{ color: "#1E293B", fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
