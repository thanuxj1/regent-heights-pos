import React, { useEffect, useState } from "react";
import { api } from "../../services/api";

/**
 * Super Admin only: how long the hosting is paid for, and the tick that adds a
 * year once the restaurant has paid. Nobody at the restaurant sees this.
 */
const longDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

const addYear = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  if (next.getUTCMonth() !== m - 1) next.setUTCDate(0); // 29 Feb → 28 Feb
  return next.toISOString().slice(0, 10);
};

export default function HostingCard() {
  const [h, setH] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = async () => {
    try { setH((await api.get("/hosting")).data); } catch { setError("Could not read the hosting date."); }
  };
  useEffect(() => { load(); }, []);

  const save = async (body) => {
    setBusy(true); setError(""); setDone("");
    try {
      const { data } = await api.post("/hosting/paid", body);
      setH(data);
      setDone(`Saved. Hosting is now paid up to ${longDate(data.paid_until)}.`);
      setConfirming(false); setEditing(false);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not save.");
    } finally { setBusy(false); }
  };

  if (!h) return null;
  const left = h.days_left;
  const tone = h.stage === "expired" ? "#B42318" : h.stage === "ok" ? "#067647" : "#B45309";
  const status = left == null ? "No date set"
    : left < 0 ? `Expired ${-left} day${left === -1 ? "" : "s"} ago`
    : left === 0 ? "Ends today"
    : `${left} day${left === 1 ? "" : "s"} left`;
  const btn = { padding: "10px 16px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", marginBottom: 28,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)", borderLeft: `5px solid ${tone}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, color: "#6B7280", fontWeight: 600 }}>Yearly hosting</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginTop: 2 }}>
            Paid up to {longDate(h.paid_until)}
          </div>
          <div style={{ fontSize: 14, color: tone, fontWeight: 600, marginTop: 2 }}>{status}</div>
          <div style={{ fontSize: 12.5, color: "#6B7280", marginTop: 6 }}>
            The shop is reminded 2 months before, again 1 month before, then every day.
          </div>
        </div>

        {h.paid_until && !confirming && !editing && (
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" style={{ ...btn, background: "#0A5BAE", color: "#fff" }}
              onClick={() => { setConfirming(true); setDone(""); }}>
              Paid — add 12 months
            </button>
            <button type="button" style={{ ...btn, background: "#F3F4F6", color: "#374151" }}
              onClick={() => { setEditing(true); setDate(h.paid_until); setDone(""); }}>
              Change date
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div style={{ marginTop: 14, padding: 14, background: "#F8FAFC", borderRadius: 10, display: "flex",
                      alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14 }}>
            Mark the next year paid? Paid up to <b>{longDate(addYear(h.paid_until))}</b>, and the reminders stop.
          </span>
          <button type="button" autoFocus disabled={busy} style={{ ...btn, background: "#067647", color: "#fff" }}
            onClick={() => save({})}>
            Yes, paid
          </button>
          <button type="button" style={{ ...btn, background: "#F3F4F6", color: "#374151" }}
            onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}

      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); save({ paid_until: date }); }}
          style={{ marginTop: 14, padding: 14, background: "#F8FAFC", borderRadius: 10, display: "flex",
                   alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 14 }}>
            Paid up to{" "}
            <input type="date" value={date} autoFocus onChange={(e) => setDate(e.target.value)}
              style={{ marginLeft: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 14 }} />
          </label>
          <button type="submit" disabled={busy || !date} style={{ ...btn, background: "#0A5BAE", color: "#fff" }}>Save</button>
          <button type="button" style={{ ...btn, background: "#F3F4F6", color: "#374151" }}
            onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}

      {done && <div style={{ marginTop: 10, color: "#067647", fontSize: 13.5 }}>{done}</div>}
      {error && <div style={{ marginTop: 10, color: "#B42318", fontSize: 13.5 }}>{error}</div>}
    </div>
  );
}
