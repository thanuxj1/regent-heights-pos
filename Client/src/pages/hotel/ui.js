export { readImageFile } from "../../utils/readImageFile";

// Shared presentation helpers for the hotel screens.

export const money = (v) =>
  `LKR ${Number(v || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortMoney = (v) =>
  `LKR ${Number(v || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

/** A cleared number field means "the default", not a silent zero. */
export const numOr = (v, dflt = 0) => {
  if (v === "" || v === null || v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export const today = () => ymd(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const dm  = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");

export const nightsBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

export const initials = (name) =>
  (name || "?").split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2);

export const STATUS_STYLE = {
  tentative:   { bg: "#FEF9C3", fg: "#92400E", label: "Tentative" },
  confirmed:   { bg: "#DBEAFE", fg: "#1E40AF", label: "Confirmed" },
  checked_in:  { bg: "#D1FAE5", fg: "#065F46", label: "In House" },
  checked_out: { bg: "#F1F5F9", fg: "#475569", label: "Checked Out" },
  cancelled:   { bg: "#FEE2E2", fg: "#B91C1C", label: "Cancelled" },
  no_show:     { bg: "#FFE4E6", fg: "#9F1239", label: "No Show" },
};

export const HK_STYLE = {
  clean:        { bg: "#D1FAE5", fg: "#065F46", label: "Clean" },
  dirty:        { bg: "#FEF9C3", fg: "#92400E", label: "Dirty" },
  inspected:    { bg: "#DBEAFE", fg: "#1E40AF", label: "Inspected" },
  maintenance:  { bg: "#FFEDD5", fg: "#C2410C", label: "Maintenance" },
  out_of_order: { bg: "#FEE2E2", fg: "#B91C1C", label: "Out of Order" },
};

export const AMENITY_OPTIONS = [
  "Air Conditioning", "Free WiFi", "Flat-screen TV", "Minibar", "Safe",
  "Balcony", "Mountain View", "City View", "Bathtub", "Shower",
  "Hair Dryer", "Tea/Coffee Maker", "Room Service", "Work Desk", "Wardrobe",
];

// ─── inline style kit ────────────────────────────────────────────────────────

export const shell   = { display: "flex", minHeight: "100vh", background: "#F4F7FB" };
export const content = { flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" };
export const main    = { flex: 1, padding: "24px", overflowY: "auto" };

export const card = {
  background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0",
};

export const input = {
  width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0",
  borderRadius: 8, fontSize: 14, boxSizing: "border-box", outline: "none",
};

export const label = { fontSize: 12, fontWeight: 600, color: "#64748B", display: "block" };

export const btn = (variant = "primary") => {
  const base = {
    padding: "9px 18px", borderRadius: 9, fontWeight: 600,
    fontSize: 13, cursor: "pointer", border: "1px solid transparent",
  };
  const variants = {
    primary: { background: "#1565C0", color: "#fff" },
    ghost:   { background: "#fff", color: "#475569", borderColor: "#E2E8F0" },
    danger:  { background: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" },
    success: { background: "#059669", color: "#fff" },
    warn:    { background: "#F59E0B", color: "#fff" },
  };
  return { ...base, ...variants[variant] };
};

export const badge = (style) => ({
  display: "inline-block", padding: "3px 10px", borderRadius: 20,
  fontSize: 11, fontWeight: 700, background: style?.bg || "#F1F5F9", color: style?.fg || "#475569",
});

export const th = {
  padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700,
  color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em",
};
export const td = { padding: "12px 16px", color: "#475569", fontSize: 13 };

export const modalWrap = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
};
export const modalBox = (maxWidth = 520) => ({
  background: "#fff", borderRadius: 16, padding: 28, width: "100%",
  maxWidth, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
});

export const errorBox = {
  background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626",
  padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13,
};

