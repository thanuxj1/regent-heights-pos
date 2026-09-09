import React, { useEffect, useRef, useState } from "react";
import { FaBell } from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import { getLowStockMaterials } from "../../services/api";
import { ROLE, canSeeLowStock } from "../../constants/roles";
import { getSocket } from "../../services/socket";

/** "just now", "4 min ago" — an alert with no age looks new forever. */
function ago(ts) {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
}

/**
 * What the order is, split into a headline and a detail line.
 *
 * One long sentence wrapped wherever it ran out of room — "Room 102 — ZZ Mr /
 * Silva" — which is exactly where a name should not break. Deciding the two
 * lines here means the break is chosen, not left to the panel width.
 */
function describeOrder(order) {
  const type = String(order?.or_type ?? "").toLowerCase();
  const n = Number(order?.item_count) || 0;
  const items = n ? `${n} item${n === 1 ? "" : "s"}` : null;
  const join = (...parts) => parts.filter(Boolean).join(" · ");

  if (type === "room_service") {
    return {
      title: join("Room service", order?.room_number ? `Room ${order.room_number}` : null),
      detail: join(order?.guest_name, items),
    };
  }
  if (type === "dine-in") {
    return { title: join("Dine-in", order?.table_id ? `Table ${order.table_id}` : null), detail: items };
  }
  if (type === "takeaway") return { title: "Takeaway order", detail: items };
  if (type === "delivery") return { title: "Delivery order", detail: items };
  return { title: "New order", detail: items };
}

/**
 * Keep the newest of each id and cap the list. A socket that reconnects can
 * replay an event, and a bell showing the same order three times is not a
 * truthful count of what happened.
 */
const MAX_NOTES = 30;
/** Anything older than this is history, not a notification. */
const NOTE_TTL_MS = 12 * 60 * 60 * 1000;
const noteKey = (viewerId) => `notifications_${viewerId || "unknown"}`;

function dedupe(list) {
  const seen = new Set();
  return list.filter((n) => (seen.has(n.id) ? false : seen.add(n.id))).slice(0, MAX_NOTES);
}

/** Survive a refresh, a logout and a shift change — a missed "order ready" is
 *  the whole reason the bell exists. Per user, so a shared terminal does not
 *  hand one cashier another's alerts. */
function loadNotes(viewerId) {
  try {
    const raw = JSON.parse(localStorage.getItem(noteKey(viewerId)) || "[]");
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - NOTE_TTL_MS;
    return raw.filter((n) => n && n.id && n.title && Number(n.ts) > cutoff).slice(0, MAX_NOTES);
  } catch { return []; }
}
function saveNotes(viewerId, notes) {
  try { localStorage.setItem(noteKey(viewerId), JSON.stringify(notes.slice(0, MAX_NOTES))); }
  catch { /* private mode, or the quota is full */ }
}

const STATUS_WORDS = {
  preparing: "is being prepared",
  completed: "is ready",
  cancelled: "was cancelled",
};

const NotificationBell = ({ branchId, showLowStock = true, viewerId = null }) => {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(() => loadNotes(viewerId));
  const panelRef = useRef(null);

  // Reload when the signed-in user changes, and write every change back.
  useEffect(() => { setNotes(loadNotes(viewerId)); }, [viewerId]);
  useEffect(() => { saveNotes(viewerId, notes); }, [viewerId, notes]);

  // Low stock is a manager's problem — the cashier is not allowed to read the
  // inventory endpoint, and asking anyway just earns a 403 on every page load.
  // Order alerts still arrive over the socket below, which is what a till needs.
  useEffect(() => {
    if (!branchId || !showLowStock) return;
    getLowStockMaterials()
      .then((data) => {
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        const lowStock = list.map((m) => ({
          id: `low-${m.rm_id}`,
          type: "warning",
          title: `Low stock: ${m.rm_name}`,
          detail: `${m.stock_qty} ${m.unit ?? ""} left`.trim(),
          ts: Date.now(),
        }));
        setNotes((prev) => dedupe([...prev, ...lowStock]));
      })
      .catch(() => {});
  }, [branchId, showLowStock]);

  // Listen for new and updated orders via socket (server already scopes to this branch's room)
  useEffect(() => {
    const socket = getSocket();

    const onNew = (order) => {
      // Server emits only to this branch's room; b_id check is a safety guard
      if (branchId && order?.b_id && Number(order.b_id) !== Number(branchId)) return;
      // Do not report someone's own action back to them. A bell that announces
      // what you just did teaches you to ignore it, and then it is worth nothing
      // when it announces something you did not.
      if (viewerId && order?.u_id && Number(order.u_id) === Number(viewerId)) return;
      setNotes((prev) => dedupe([{
        id: `order-${order?.or_id ?? Date.now()}`,
        type: "info",
        ...describeOrder(order),
        ref: order?.or_id ? `#${order.or_id}` : null,
        ts: Date.now(),
      }, ...prev]));
    };

    const onUpdated = (order) => {
      if (branchId && order?.b_id && Number(order.b_id) !== Number(branchId)) return;
      if (["preparing", "completed", "cancelled"].includes(order?.or_status)) {
        if (viewerId && order?.u_id && Number(order.u_id) === Number(viewerId)) return;
        setNotes((prev) => dedupe([{
          id: `upd-${order?.or_id}-${order?.or_status}`,
          type: order?.or_status === "completed" ? "success" : "info",
          title: `${describeOrder(order).title} ${STATUS_WORDS[order.or_status]}`,
          detail: describeOrder(order).detail,
          ref: order?.or_id ? `#${order.or_id}` : null,
          ts: Date.now(),
        }, ...prev]));
      }
    };

    socket.on("order:new", onNew);
    socket.on("order:updated", onUpdated);
    return () => {
      socket.off("order:new", onNew);
      socket.off("order:updated", onUpdated);
    };
  }, [branchId]);

  // Re-render while the panel is open so "just now" becomes "2 min ago" instead
  // of staying true only for the instant it was written.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [open]);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const unread = notes.length;
  const dismiss = (id) => setNotes((prev) => prev.filter((n) => n.id !== id));
  const clearAll = () => setNotes([]);

  return (
    <div style={{ position: "relative" }} ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", position: "relative", padding: "4px" }}
        aria-label="Notifications"
      >
        <FaBell size={20} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            background: "#ef4444", color: "#fff",
            borderRadius: "50%", width: 16, height: 16,
            fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, lineHeight: 1,
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)", right: 0,
          // 320px broke "Room 102 — ZZ Mr / Silva" across a line. Wide enough for
          // a room and a guest name on one line, capped so it still fits a tablet.
          width: "min(420px, calc(100vw - 32px))",
          background: "#fff", borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)", zIndex: 200,
          overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", background: "#1565C0", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications {unread > 0 ? `(${unread})` : ""}</span>
            {unread > 0 && (
              <button onClick={clearAll} style={{ background: "none", border: "none", color: "#90CAF9", fontSize: 12, cursor: "pointer" }}>
                Clear all
              </button>
            )}
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {notes.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                No notifications
              </div>
            ) : (
              notes.map((n) => (
                <div key={n.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "10px 16px", borderBottom: "1px solid #f1f5f9",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                    {n.type === "warning" ? "⚠️" : "🔔"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1E293B",
                                   overflowWrap: "anywhere" }}>
                      {n.title}
                    </span>
                    {n.detail && (
                      <span style={{ display: "block", fontSize: 12, color: "#475569", marginTop: 1,
                                     overflowWrap: "anywhere" }}>
                        {n.detail}
                      </span>
                    )}
                    <span style={{ display: "block", fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                      {ago(n.ts)}{n.ref ? ` · ${n.ref}` : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => dismiss(n.id)}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Header = ({ title = "Product Management", actions = null }) => {
  const { user } = useAuth();
  const isCashier = Number(user?.role_id) === ROLE.CASHIER;

  return (
    <header
      style={{
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        boxSizing: "border-box",
        color: "#fff",
        background: "linear-gradient(135deg, #0D47A1 0%, #1565C0 60%, #00B5E2 100%)",
      }}
    >
      <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600, letterSpacing: 0.2 }}>{title}</h1>

      {/* Only the bell earns a place here — it carries live low-stock and order
          alerts. The signed-in user lives in the sidebar footer, not twice.
          `actions` is for buttons that belong to the page, so a page never has
          to grow a second bar of its own to hold them. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {actions}
        <NotificationBell
          branchId={user?.b_id ?? null}
          showLowStock={canSeeLowStock(user?.role_id)}
          viewerId={user?.u_id ?? null}
        />
      </div>
    </header>
  );
};

export default Header;
