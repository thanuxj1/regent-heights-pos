import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getHotelDashboard, checkInBooking } from "../../services/api";
import {
  card, btn, badge, th, td,
  money, dmy, initials, STATUS_STYLE,
} from "./ui";

// Module scope on purpose: a component declared inside another is a fresh type on
// every render, so React remounts the whole subtree instead of updating it.
const GuestRow = ({ b, action }) => {
  const st = STATUS_STYLE[b.status] || {};
  return (
    <tr style={{ borderTop: "1px solid #F1F5F9" }}>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#1565C0", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
            {initials(b.guest_name)}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "#1E293B" }}>{b.guest_name || "Guest"}</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>{b.booking_ref}</div>
          </div>
        </div>
      </td>
      <td style={td}>
        {(b.rooms || []).map(r => r.room_number ? `Room ${r.room_number}` : r.type_name).join(", ") || "—"}
      </td>
      <td style={td}>{b.nights}n · {b.adults}A{b.children ? ` ${b.children}C` : ""}</td>
      <td style={td}><span style={badge(st)}>{st.label || b.status}</span></td>
      <td style={td}>{action}</td>
    </tr>
  );
};

const Panel = ({ title, rows, empty, action }) => (
  <div style={{ ...card, overflow: "hidden", marginBottom: 20 }}>
    <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", fontWeight: 700, fontSize: 14, color: "#1E293B" }}>
      {title} <span style={{ color: "#94A3B8", fontWeight: 400 }}>({rows.length})</span>
    </div>
    {rows.length === 0 ? (
      <div style={{ padding: 28, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>{empty}</div>
    ) : (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#F8FAFC" }}>
            {["Guest", "Room", "Stay", "Status", ""].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map(b => <GuestRow key={b.booking_id} b={b} action={action(b)} />)}</tbody>
        </table>
      </div>
    )}
  </div>
);

export default function FrontDesk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    if (!branchId) return;
    try {
      setData(await getHotelDashboard({ b_id: branchId }));
    } catch { /* surfaced as empty state */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [branchId]);

  const quickCheckIn = async (booking) => {
    const unassigned = (booking.rooms || []).some(r => !r.room_id);
    if (unassigned) { navigate(`/hotel/bookings/${booking.booking_id}`); return; }
    setBusyId(booking.booking_id);
    try {
      await checkInBooking(booking.booking_id);
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Check-in failed");
    } finally { setBusyId(null); }
  };

  const rooms = data?.rooms || {};

  const stats = [
    { label: "Occupancy",  value: `${rooms.occupancy_pct ?? 0}%`,      sub: `${rooms.occupied ?? 0} of ${rooms.total ?? 0} rooms`, bg: "#EFF6FF", fg: "#1565C0", bd: "#BFDBFE" },
    { label: "Arrivals",   value: data?.arrivals?.length ?? 0,         sub: "expected today",  bg: "#D1FAE5", fg: "#065F46", bd: "#A7F3D0" },
    { label: "Departures", value: data?.departures?.length ?? 0,       sub: "due out today",   bg: "#FEF9C3", fg: "#92400E", bd: "#FDE68A" },
    { label: "In House",   value: data?.in_house?.length ?? 0,         sub: "staying tonight", bg: "#F3E8FF", fg: "#6B21A8", bd: "#E9D5FF" },
  ];

  return (
    <AppShell title="Front Desk">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ color: "#64748B", fontSize: 13 }}>
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <button onClick={() => navigate("/hotel/bookings?new=1")} style={btn("primary")}>+ New Booking</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.fg, margin: "4px 0 2px" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#94A3B8" }}>Loading front desk…</div>
          ) : (
            <>
              <Panel
                title="Arrivals Today" rows={data?.arrivals || []}
                empty="No arrivals scheduled for today."
                action={(b) => (
                  <button onClick={() => quickCheckIn(b)} disabled={busyId === b.booking_id} style={btn("success")}>
                    {busyId === b.booking_id ? "…" : "Check In"}
                  </button>
                )}
              />
              <Panel
                title="Departures Today" rows={data?.departures || []}
                empty="No departures due today."
                action={(b) => (
                  <button onClick={() => navigate(`/hotel/bookings/${b.booking_id}`)} style={btn("warn")}>
                    Check Out
                  </button>
                )}
              />
              <Panel
                title="In House" rows={data?.in_house || []}
                empty="No guests currently in house."
                action={(b) => (
                  <button onClick={() => navigate(`/hotel/bookings/${b.booking_id}`)} style={btn("ghost")}>
                    View Folio
                  </button>
                )}
              />

              <div style={{ ...card, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 14 }}>Housekeeping</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {[
                    ["Clean", rooms.clean, "#065F46"],
                    ["Dirty", rooms.dirty, "#92400E"],
                    ["Blocked", rooms.blocked, "#B91C1C"],
                    ["Available", rooms.available, "#1565C0"],
                  ].map(([k, v, c]) => (
                    <div key={k}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v ?? 0}</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
    </AppShell>
  );
}
