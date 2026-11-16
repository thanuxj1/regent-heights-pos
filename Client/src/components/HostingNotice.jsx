import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

/**
 * The yearly hosting is paid up to a date. As it nears, the shop is told:
 * once at two months, again at one month, then every day of the last month,
 * and every day after if it runs out. Nothing stops working; it only says so.
 *
 * Each screen remembers what it has already shown, so a till sees each notice
 * once (once a day in the last month), not on every page change. The header
 * keeps a small chip with the days left the whole time; a tap opens the notice.
 */
const CONTACT = "Thanuja Weerasekara · +94 76 061 9944";
const SHOWN_TO = [1, 2, 3]; // Administrator, company Admin, Cashier

// One copy of the date and of "is the notice open", shared by the popup (on
// every screen) and the chip in the header.
let state = { hosting: null, open: false };
const listeners = new Set();
const setState = (next) => { state = { ...state, ...next }; listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const useHosting = () => useSyncExternalStore(subscribe, () => state);

const longDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function slotFor(h) {
  if (h.stage === "two_months") return `${h.paid_until}:60`;
  if (h.stage === "daily" || h.stage === "expired") return `${h.paid_until}:${h.today}`;
  return null;
}

const seen = (slot) => { try { return localStorage.getItem(`hosting-notice:${slot}`) === "1"; } catch { return false; } };
const markSeen = (slot) => { try { localStorage.setItem(`hosting-notice:${slot}`, "1"); } catch { /* private window */ } };

export function hostingWords(h) {
  const when = longDate(h.paid_until);
  if (h.stage === "expired") {
    const ago = -h.days_left;
    return {
      title: "Hosting has expired",
      line: `The yearly hosting ran out on ${when}${ago > 0 ? ` (${plural(ago, "day")} ago)` : ""}.`,
      ask: "Please pay the yearly hosting now to keep the system online.",
      short: "Hosting expired",
    };
  }
  const left = h.days_left === 0 ? "ends today" : `${plural(h.days_left, "day")} left`;
  return {
    title: h.days_left === 0 ? "Hosting ends today" : `Hosting renewal due in ${plural(h.days_left, "day")}`,
    line: `The yearly hosting for this system is paid up to ${when} (${left}).`,
    ask: "Please pay the next year's hosting before that date so the system keeps running.",
    short: `Hosting: ${left}`,
  };
}

const toneOf = (h) => (h.stage === "expired"
  ? { bg: "#FEF2F2", fg: "#B42318", line: "#FECACA", btn: "#B42318" }
  : { bg: "#FFFBEB", fg: "#92400E", line: "#FDE68A", btn: "#B45309" });

/** The chip beside the bell in the header. Nothing when there is nothing to say. */
export function HostingChip() {
  const { user } = useAuth();
  const { hosting } = useHosting();
  if (!user || !SHOWN_TO.includes(Number(user.role_id)) || !hosting || hosting.stage === "ok") return null;
  const words = hostingWords(hosting);
  const tone = toneOf(hosting);
  return (
    <button
      type="button"
      onClick={() => setState({ open: true })}
      title={words.line}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999,
        border: `1px solid ${tone.line}`, background: tone.bg, color: tone.fg, fontSize: 13, fontWeight: 600,
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone.btn }} />
      {words.short}
    </button>
  );
}

/** Mounted once for the whole app: reads the date and opens the notice when due. */
export default function HostingNotice() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { hosting, open } = useHosting();
  const okRef = useRef(null);
  const applies = !!user && SHOWN_TO.includes(Number(user?.role_id)) && pathname !== "/" && pathname !== "/login";

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/hosting");
      setState({ hosting: data });
    } catch { /* offline or signed out: say nothing */ }
  }, []);

  useEffect(() => {
    if (!applies) { setState({ hosting: null, open: false }); return undefined; }
    load();
    const t = setInterval(load, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [applies, load]);

  // A notice not yet shown on this screen opens by itself.
  useEffect(() => {
    if (!applies || !hosting) return;
    const slot = slotFor(hosting);
    if (slot && !seen(slot)) setState({ open: true });
  }, [applies, hosting]);

  useEffect(() => { if (open) okRef.current?.focus(); }, [open]);

  if (!applies || !hosting || hosting.stage === "ok" || !open) return null;

  const words = hostingWords(hosting);
  const tone = toneOf(hosting);
  const close = () => {
    const slot = slotFor(hosting);
    if (slot) markSeen(slot);
    setState({ open: false });
  };

  return (
    <div
      role="presentation"
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.45)",
               display: "grid", placeItems: "center", padding: 16 }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hosting-notice-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); close(); } }}
        style={{ width: "100%", maxWidth: 420, maxHeight: "calc(100vh - 32px)", overflowY: "auto",
                 background: "#fff", borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}
      >
        <div style={{ background: tone.bg, borderBottom: `1px solid ${tone.line}`, padding: "18px 22px" }}>
          <div id="hosting-notice-title" style={{ color: tone.fg, fontSize: 18, fontWeight: 700 }}>{words.title}</div>
        </div>
        <div style={{ padding: "18px 22px", color: "#1F2937", fontSize: 14, lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>{words.line}</p>
          <p style={{ margin: "10px 0 0" }}>{words.ask}</p>
          <p style={{ margin: "14px 0 0", color: "#6B7280", fontSize: 13 }}>{CONTACT}</p>
        </div>
        <div style={{ padding: "0 22px 20px", display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={okRef}
            type="button"
            onClick={close}
            style={{ minWidth: 120, padding: "12px 20px", borderRadius: 10, border: "none",
                     background: tone.btn, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
