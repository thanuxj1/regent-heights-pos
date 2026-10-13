import React, { useEffect, useState } from "react";
import { getConnectionStatus, onConnectionChange } from "../services/connection";

/**
 * A quiet note while the connection is weak or gone, instead of red errors on
 * every screen. Requests are retried by themselves (services/api.js) and the
 * till keeps sales queued, so the message is "it is being handled", not "stop".
 */
export default function ConnectionBanner() {
  const [status, setStatus] = useState(getConnectionStatus());
  const [justRecovered, setJustRecovered] = useState(false);

  useEffect(() => onConnectionChange((next) => {
    setStatus((prev) => {
      if (prev !== "ok" && next === "ok") {
        setJustRecovered(true);
        setTimeout(() => setJustRecovered(false), 2500);
      }
      return next;
    });
  }), []);

  if (status === "ok" && !justRecovered) return null;

  const look = status === "offline"
    ? { bg: "#1E293B", fg: "#F8FAFC", dot: "#F87171", text: "Offline — the till keeps working and sales will sync when the connection is back." }
    : status === "weak"
      ? { bg: "#FFFBEB", fg: "#92400E", dot: "#F59E0B", text: "Weak connection — retrying…" }
      : { bg: "#ECFDF3", fg: "#067647", dot: "#22C55E", text: "Back online" };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 9999,
        display: "flex", alignItems: "center", gap: 8, maxWidth: "calc(100vw - 32px)",
        padding: "8px 14px", borderRadius: 999, background: look.bg, color: look.fg,
        fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
        border: status === "weak" ? "1px solid #FDE68A" : "none", pointerEvents: "none",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: look.dot, flexShrink: 0 }} />
      {look.text}
    </div>
  );
}
