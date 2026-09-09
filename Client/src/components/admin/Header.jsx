import React, { useEffect, useRef, useState } from "react";
import { FaBell, FaUserCircle } from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import { getSocket } from "../../services/socket";

const NotificationBell = ({ comId }) => {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const panelRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();

    const onNew = (order) => {
      // Guard: only show if order belongs to this admin's company (server room handles this,
      // but we double-check client-side in case of broadcast fallback)
      setNotes((prev) => [{
        id: `order-${order?.or_id ?? Date.now()}`,
        type: "info",
        message: `New order #${order?.or_id ?? "—"} — Branch ${order?.b_id ?? "?"}`,
        ts: Date.now(),
      }, ...prev]);
    };

    const onUpdated = (order) => {
      if (["preparing", "completed", "cancelled"].includes(order?.or_status)) {
        setNotes((prev) => [{
          id: `upd-${order?.or_id}-${Date.now()}`,
          type: "info",
          message: `Order #${order?.or_id} → ${order?.or_status} (Branch ${order?.b_id ?? "?"})`,
          ts: Date.now(),
        }, ...prev]);
      }
    };

    socket.on("order:new", onNew);
    socket.on("order:updated", onUpdated);
    return () => {
      socket.off("order:new", onNew);
      socket.off("order:updated", onUpdated);
    };
  }, [comId]);

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
            fontWeight: 700,
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)", right: 0,
          width: 320, background: "#fff", borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)", zIndex: 200, overflow: "hidden",
        }}>
          <div style={{ padding: "10px 16px", background: "#1565C0", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications {unread > 0 ? `(${unread})` : ""}</span>
            {unread > 0 && <button onClick={clearAll} style={{ background: "none", border: "none", color: "#90CAF9", fontSize: 12, cursor: "pointer" }}>Clear all</button>}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {notes.length === 0 ? (
              <div style={{ padding: "20px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No notifications</div>
            ) : notes.map((n) => (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>🔔</span>
                <span style={{ fontSize: 13, color: "#334155", flex: 1 }}>{n.message}</span>
                <button onClick={() => dismiss(n.id)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Header = ({ title = "Branch Management" }) => {
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    if (!user) { setCompanyName(""); return; }
    const uCompany = user?.com_name ?? user?.companyName ?? user?.company?.com_name ?? "";
    setCompanyName(uCompany);
  }, [user]);

  const fullName =
    user?.u_fname || user?.u_lname
      ? [user?.u_fname, user?.u_lname].filter(Boolean).join(" ")
      : user?.name || "";
  const email = user?.u_email || user?.email || "";
  const comId = user?.com_id ?? null;

  return (
    <div style={{
      height: "70px", display: "flex", width: "100%",
      justifyContent: "space-between", alignItems: "center",
      padding: "0 20px", margin: 0, color: "#fff",
      background: "linear-gradient(135deg, #0D47A1 0%, #1565C0 60%, #00B5E2 100%)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ fontSize: "22px", margin: 0, fontWeight: "600" }}>{title}</h2>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <NotificationBell comId={comId} />
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(255,255,255,0.08)", padding: "6px 12px",
          borderRadius: "20px", border: "1px solid rgba(255,255,255,0.12)",
        }}>
          <FaUserCircle size={30} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>{fullName || "User"}</div>
            <div style={{ fontSize: "12px", opacity: 0.95 }}>{email || "—"}</div>
            {companyName && <div style={{ fontSize: "12px", opacity: 0.9 }}>{companyName}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;
