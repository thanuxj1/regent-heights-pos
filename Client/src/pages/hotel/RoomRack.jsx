import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getRoomGrid, getBookingById, checkInBooking, cancelBooking,
  getRooms, updateRoom, getBranchProducts, createRoomServiceOrder,
} from "../../services/api";
import { connectSocket } from "../../services/socket";
import { money, dmy, today, btn, input, label, modalWrap, modalBox, errorBox, card } from "./ui";

// Palette follows the reference rack: green free, amber reserved, indigo in-house, grey blocked.
const RACK = {
  available: { bg: "#B7E4C7", fg: "#14532D", line: "#74C69D", label: "Available" },
  booked:    { bg: "#F7C59F", fg: "#7C2D12", line: "#EE9B6E", label: "Booked" },
  occupied:  { bg: "#B0BEF0", fg: "#1E1B4B", line: "#8A9BE8", label: "Occupied" },
  dirty:     { bg: "#DDE1E6", fg: "#334155", line: "#C0C6CC", label: "Dirty" },
};

const SOURCE_TAG = { ota: "B", online: "B", agent: "A", phone: "P", walk_in: "W", email: "E" };

// Module scope on purpose — see the note in Bookings.jsx. A component declared
// inside another is a new type on every render and forces a remount.
const Row = ({ k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
    <span style={{ color: "#64748B" }}>{k}</span>
    <span style={{ color: "#1E293B", fontWeight: 500, textAlign: "right" }}>{v}</span>
  </div>
);

const SectionTitle = ({ children }) => (
  <div style={{ fontSize: 13, fontWeight: 700, color: "#1565C0", margin: "16px 0 6px",
                paddingBottom: 5, borderBottom: "1px solid #F1F5F9" }}>{children}</div>
);

export default function RoomRack() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [date, setDate] = useState(today());
  const [grid, setGrid] = useState({ rooms: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [typeTab, setTypeTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [serviceRoom, setServiceRoom] = useState(null);

  const [live, setLive] = useState(false);

  const load = async (silent = false) => {
    if (!branchId) return;
    if (!silent) setLoading(true);
    try { setGrid(await getRoomGrid({ b_id: branchId, date })); setError(""); }
    catch (e) { setError(e?.response?.data?.message || "Could not load rooms"); }
    finally { if (!silent) setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, date]);

  // Live rack: a check-in, check-out or room-service order on any terminal
  // repaints every front desk within about a second.
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
  }, [branchId, date]);

  const types = useMemo(
    () => [...new Set(grid.rooms.map(r => r.type_name).filter(Boolean))],
    [grid.rooms]
  );

  const shown = useMemo(() => grid.rooms.filter(r => {
    if (typeTab !== "all" && r.type_name !== typeTab) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  }), [grid.rooms, typeTab, statusFilter]);

  const markClean = async (room) => {
    try { await updateRoom(room.room_id, { hk_status: "clean" }); load(); }
    catch { setError("Could not update housekeeping status"); }
  };

  return (
    <AppShell title="Rooms">
      {error && <div style={errorBox}>{error}</div>}

      {/* Type tabs + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[["all", "All rooms"], ...types.map(t => [t, t])].map(([k, l]) => (
          <button key={k} onClick={() => setTypeTab(k)}
            style={{
              padding: "8px 16px", border: "none", background: "none", cursor: "pointer",
              fontSize: 14, fontWeight: typeTab === k ? 700 : 400,
              color: typeTab === k ? "#1565C0" : "#64748B",
              borderBottom: typeTab === k ? "2px solid #1565C0" : "2px solid transparent",
            }}>
            {l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => navigate("/hotel/bookings?new=1")} style={btn("ghost")}>Add Booking</button>
        <button onClick={() => navigate("/hotel/front-desk")} style={btn("primary")}>Arrivals</button>
      </div>

      {/* Legend + date */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
        {Object.entries(RACK).map(([k, s]) => (
          <button key={k} onClick={() => setStatusFilter(statusFilter === k ? "all" : k)}
            title={`Show only ${s.label.toLowerCase()}`}
            style={{
              display: "flex", alignItems: "center", gap: 7, background: "none", cursor: "pointer",
              border: "none", padding: "4px 8px", borderRadius: 6, fontSize: 13,
              color: statusFilter === k ? "#1E293B" : "#64748B",
              fontWeight: statusFilter === k ? 700 : 400,
              outline: statusFilter === k ? "1px solid #CBD5E1" : "none",
            }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: s.bg, border: `1px solid ${s.line}` }} />
            {s.label} <span style={{ color: "#94A3B8" }}>{grid.counts[k] ?? 0}</span>
          </button>
        ))}
        {grid.counts?.overstay > 0 && (
          <span title="Guests past their departure date who have not been checked out"
            style={{
              display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700,
              color: "#B91C1C", padding: "4px 8px",
            }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#DC2626" }} />
            Overdue <span style={{ color: "#EF4444" }}>{grid.counts.overstay}</span>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B" }}
          title={live ? "Updates automatically when anyone checks in or orders" : "Reconnecting…"}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "#10B981" : "#CBD5E1" }} />
          {live ? "Live" : "Offline"}
        </span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ ...input, width: 175 }} />
      </div>

      {/* Rack */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading rooms…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, padding: 48, textAlign: "center", color: "#94A3B8" }}>
          {grid.rooms.length === 0
            ? "No rooms set up yet. Add them under Hotel → Rooms & Housekeeping."
            : "No rooms match this filter."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {shown.map(r => {
            const s = RACK[r.status];
            const surname = r.guest_name ? r.guest_name.trim().split(/\s+/).slice(-1)[0] : null;
            return (
              <button key={r.room_id} onClick={() => setSelected(r)}
                style={{
                  background: s.bg,
                  // Still occupied — but the guest is past their departure, which
                  // is a bill to close and a room housekeeping is waiting on.
                  border: r.overstay ? "2px solid #DC2626" : `1px solid ${s.line}`,
                  borderRadius: 10,
                  padding: "14px 12px", cursor: "pointer", textAlign: "center",
                  minHeight: 72, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 2,
                  color: s.fg, fontFamily: "inherit", position: "relative",
                }}>
                {r.overstay && (
                  <span title="Past their departure date and still in the room"
                    style={{
                      position: "absolute", top: 4, right: 4, background: "#DC2626", color: "#fff",
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                      padding: "1px 5px", borderRadius: 4,
                    }}>LATE</span>
                )}
                <div style={{ fontSize: 14 }}>
                  <strong style={{ fontWeight: 700 }}>{r.room_number}</strong>{" "}
                  <span style={{ opacity: 0.85 }}>{r.type_name}</span>
                </div>
                {surname && (
                  <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontWeight: 600 }}>{surname}</span>
                    {r.status === "occupied" ? (
                      <span title="Checked in" style={{
                        width: 14, height: 14, borderRadius: "50%", background: "#0F766E", color: "#fff",
                        fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}>✓</span>
                    ) : (
                      <span title={r.source} style={{
                        width: 14, height: 14, borderRadius: 3, background: "#2563EB", color: "#fff",
                        fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}>{SOURCE_TAG[r.source] || "P"}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <RoomDetailModal
          room={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); load(); }}
          onMarkClean={markClean}
          onRoomService={(room) => { setSelected(null); setServiceRoom(room); }}
          onOpenBooking={(bid) => navigate(`/hotel/bookings/${bid}`)}
          onOpenGuest={(gid) => navigate(`/hotel/guests/${gid}`)}
        />
      )}

      {serviceRoom && (
        <RoomServiceModal
          room={serviceRoom} branchId={branchId}
          onClose={() => setServiceRoom(null)}
          onSent={() => { setServiceRoom(null); load(); }}
        />
      )}
    </AppShell>
  );
}

// ─── Room detail ─────────────────────────────────────────────────────────────

function RoomDetailModal({ room, onClose, onChanged, onMarkClean, onRoomService, onOpenBooking, onOpenGuest }) {
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const s = RACK[room.status];

  useEffect(() => {
    if (room.booking_id) getBookingById(room.booking_id).then(setBooking).catch(() => {});
  }, [room.booking_id]);

  const act = async (name, fn) => {
    setBusy(name); setErr("");
    try { await fn(); onChanged(); }
    catch (e) { setErr(e?.response?.data?.message || `${name} failed`); setBusy(""); }
  };

  const paid = Number(booking?.paid_total ?? room.advance_paid ?? 0);
  const total = Number(booking?.grand_total ?? room.grand_total ?? 0);
  const balance = total - paid;
  const payLabel = total > 0 && balance <= 0.01 ? "Paid" : paid > 0 ? "Part paid" : "Unpaid";
  const payStyle = payLabel === "Paid"
    ? { bg: "#D1FAE5", fg: "#065F46" }
    : payLabel === "Part paid" ? { bg: "#FEF9C3", fg: "#92400E" } : { bg: "#FEE2E2", fg: "#B91C1C" };

  return (
    <div style={modalWrap}><div style={modalBox(440)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
            Room {room.room_number}
          </h2>
          <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
            {room.type_name}{room.floor ? ` · Floor ${room.floor}` : ""} · {money(room.base_rate)}/night
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                         background: s.bg, color: s.fg }}>{s.label}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 19, color: "#94A3B8", cursor: "pointer" }}>✕</button>
        </div>
      </div>

      {err && <div style={{ ...errorBox, marginTop: 14 }}>{err}</div>}

      {!room.booking_id ? (
        <>
          <div style={{ padding: "28px 0", textAlign: "center", color: "#94A3B8", fontSize: 14 }}>
            {room.status === "dirty"
              ? "This room needs housekeeping before it can be sold."
              : "No booking on this room for the selected date."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {room.status === "dirty" && (
              <button onClick={() => onMarkClean(room)} style={{ ...btn("success"), flex: 1 }}>
                Mark Clean
              </button>
            )}
            <button onClick={onClose} style={{ ...btn("ghost"), flex: 1 }}>Close</button>
          </div>
        </>
      ) : (
        <>
          <SectionTitle>Booking Details</SectionTitle>
          <Row k="Booking Ref" v={room.booking_ref} />
          <Row k="Source" v={(room.source || "").replace(/_/g, " ")} />
          <Row k="From → To" v={`${dmy(room.check_in_date)} → ${dmy(room.check_out_date)}`} />
          <Row k="Guests" v={`${room.adults} adult(s)${room.children ? `, ${room.children} child(ren)` : ""}`} />
          {booking?.plan_name && <Row k="Meal plan" v={booking.plan_name} />}
          {booking?.special_requests && <Row k="Special request" v={booking.special_requests} />}

          <SectionTitle>Guest Info</SectionTitle>
          <Row k="Full name" v={room.guest_name || "—"} />
          <Row k="Phone" v={room.guest_phone || "—"} />
          <Row k="Country" v={room.country || "—"} />
          {room.guest_id && (
            <button onClick={() => onOpenGuest(room.guest_id)}
              style={{ ...btn("ghost"), width: "100%", marginTop: 8 }}>
              View full guest history
            </button>
          )}

          <SectionTitle>Payment</SectionTitle>
          <Row k="Total" v={money(total)} />
          <Row k="Paid" v={money(paid)} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
            <span style={{ color: "#64748B" }}>Status</span>
            <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                           background: payStyle.bg, color: payStyle.fg }}>
              {payLabel}{balance > 0.01 ? ` · ${money(balance)} due` : ""}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            {room.status === "booked" && (
              <>
                <button
                  onClick={() => {
                    if (!confirm(`Cancel booking ${room.booking_ref}?`)) return;
                    act("cancel", () => cancelBooking(room.booking_id, "Cancelled from rack"));
                  }}
                  disabled={!!busy}
                  style={{ ...btn("danger"), flex: 1 }}>
                  Cancel booking
                </button>
                <button onClick={() => act("check-in", () => checkInBooking(room.booking_id, {}))}
                  disabled={!!busy} style={{ ...btn("primary"), flex: 1.4 }}>
                  {busy === "check-in" ? "Checking in…" : "Proceed to check-in"}
                </button>
              </>
            )}
            {room.status === "occupied" && (
              <>
                <button onClick={() => onRoomService(room)} style={{ ...btn("ghost"), flex: 1 }}>
                  Room service
                </button>
                <button onClick={() => onOpenBooking(room.booking_id)} style={{ ...btn("primary"), flex: 1 }}>
                  Folio & check-out
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div></div>
  );
}

// ─── Room service ────────────────────────────────────────────────────────────

function RoomServiceModal({ room, branchId, onClose, onSent }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    getBranchProducts(branchId).then(setProducts).catch(() => {});
  }, [branchId]);

  const priceOf = (p) => Number(p[" Pro_Price"] ?? p.Pro_Price ?? p.pro_price ?? 0);
  const nameOf  = (p) => p.pro_name || "Item";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? products.filter(p => nameOf(p).toLowerCase().includes(q)) : products;
    return list.slice(0, 60);
  }, [products, search]);

  const add = (p) => setCart(c => {
    const hit = c.find(x => x.Bpro_id === p.Bpro_id);
    if (hit) return c.map(x => x.Bpro_id === p.Bpro_id ? { ...x, qty: x.qty + 1 } : x);
    return [...c, { Bpro_id: p.Bpro_id, name: nameOf(p), price: priceOf(p), qty: 1 }];
  });
  const setQty = (id, q) => setCart(c =>
    q <= 0 ? c.filter(x => x.Bpro_id !== id) : c.map(x => x.Bpro_id === id ? { ...x, qty: q } : x));

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const send = async () => {
    if (!cart.length) { setErr("Add at least one item"); return; }
    setBusy(true); setErr("");
    try {
      const r = await createRoomServiceOrder({
        room_id: room.room_id,
        notes: notes || undefined,
        items: cart.map(i => ({ Bpro_id: i.Bpro_id, pro_quantity: i.qty, unit_price: i.price })),
      });
      setDone(r);
    } catch (e) {
      setErr(e?.response?.data?.message || "Could not send the order");
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={modalWrap}><div style={modalBox(400)}>
        <div style={{ textAlign: "center", padding: "14px 0" }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>🍽️</div>
          <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Sent to kitchen</h2>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 4 }}>
            Order #{done.order.or_id} for Room {done.room_number}
          </div>
          <div style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>
            {money(done.total)} charged to {done.guest_name || "the guest"}'s folio
          </div>
        </div>
        <button onClick={onSent} style={{ ...btn("primary"), width: "100%", padding: 11, marginTop: 10 }}>Done</button>
      </div></div>
    );
  }

  return (
    <div style={modalWrap}><div style={modalBox(680)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
          Room Service — Room {room.room_number}
        </h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 19, color: "#94A3B8", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 16 }}>
        Goes straight to the kitchen and onto {room.guest_name || "the guest"}'s bill.
      </div>

      {err && <div style={errorBox}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 18 }}>
        <div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search the menu…" style={{ ...input, marginBottom: 10 }} />
          <div style={{ maxHeight: 300, overflowY: "auto", display: "grid",
                        gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 }}>
            {shown.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: 13, gridColumn: "1/-1", padding: 20, textAlign: "center" }}>
                No menu items found.
              </div>
            ) : shown.map(p => (
              <button key={p.Bpro_id} onClick={() => add(p)}
                style={{ ...card, padding: 10, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1E293B",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {nameOf(p)}
                </div>
                <div style={{ fontSize: 12, color: "#1565C0", fontWeight: 700, marginTop: 3 }}>
                  {money(priceOf(p))}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B", marginBottom: 10 }}>
            Order ({cart.length})
          </div>
          <div style={{ flex: 1, maxHeight: 200, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: 12, textAlign: "center", padding: 20 }}>
                Tap menu items to add
              </div>
            ) : cart.map(i => (
              <div key={i.Bpro_id} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid #F8FAFC" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1E293B" }}>{i.name}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setQty(i.Bpro_id, i.qty - 1)}
                      style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #E2E8F0",
                               background: "#fff", cursor: "pointer", fontSize: 13 }}>−</button>
                    <span style={{ fontSize: 12, minWidth: 16, textAlign: "center" }}>{i.qty}</span>
                    <button onClick={() => setQty(i.Bpro_id, i.qty + 1)}
                      style={{ width: 22, height: 22, borderRadius: 5, border: "1px solid #E2E8F0",
                               background: "#fff", cursor: "pointer", fontSize: 13 }}>+</button>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1E293B" }}>{money(i.price * i.qty)}</span>
                </div>
              </div>
            ))}
          </div>

          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Notes for the kitchen…"
            style={{ ...input, marginTop: 8, fontSize: 12, resize: "vertical" }} />

          <div style={{ display: "flex", justifyContent: "space-between", margin: "12px 0 10px",
                        paddingTop: 10, borderTop: "2px solid #E2E8F0", fontWeight: 700, color: "#1E293B" }}>
            <span>Total</span><span>{money(total)}</span>
          </div>
          <button onClick={send} disabled={busy || !cart.length}
            style={{ ...btn("primary"), width: "100%", padding: 11, opacity: busy || !cart.length ? 0.55 : 1 }}>
            {busy ? "Sending…" : "Send to Kitchen"}
          </button>
        </div>
      </div>
    </div></div>
  );
}
