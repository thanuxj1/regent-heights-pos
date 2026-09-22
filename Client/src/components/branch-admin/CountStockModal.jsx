import React, { useState } from "react";

const overlay = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)",
};
const box = {
  background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 420,
  boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
};
const label = { display: "block", fontSize: 13, fontWeight: 600, color: "#334155", margin: "14px 0 6px" };
const field = {
  width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #CBD5E1",
  fontSize: 15, outline: "none", boxSizing: "border-box",
};
const show = (n) => String(Number(Number(n || 0).toFixed(3)));

/**
 * Count what is actually on the shelf.
 *
 * Sales never stop because the system thinks something has run out, so a wrong
 * figure shows up as stock below zero. This is where the manager puts it right.
 * The reason is required: it goes on the stock ledger and in the activity log,
 * with their name, because a correction with no reason is indistinguishable from
 * someone hiding a loss.
 */
export default function CountStockModal({ title, unit = "", current, wholeNumbers = false, onSave, onClose }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const value = Number(counted);
  const numberOk = counted !== "" && Number.isFinite(value) && value >= 0
    && (!wholeNumbers || Number.isInteger(value));
  const valid = numberOk && note.trim().length >= 3;
  const diff = numberOk ? +(value - Number(current || 0)).toFixed(3) : null;
  const below = Number(current) < 0;

  const save = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ counted: value, note: note.trim() });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error || err?.message
        || "Could not save the count");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <form style={box} onSubmit={save} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>Count {title}</h3>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748B" }}>
          The system says <strong style={{ color: below ? "#B91C1C" : "#0F172A" }}>{show(current)} {unit}</strong>
          {below ? " — below zero, so more was sold than it knew about." : "."} Count what is really
          there and enter it.
        </p>

        <label style={label}>Counted{unit ? ` (${unit})` : ""}</label>
        <input style={field} type="number" inputMode="decimal" min="0" step={wholeNumbers ? "1" : "0.001"}
          value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        {diff !== null && diff !== 0 && (
          <div style={{ marginTop: 6, fontSize: 13, color: diff > 0 ? "#047857" : "#B45309" }}>
            {diff > 0 ? `${show(diff)} ${unit} more` : `${show(-diff)} ${unit} less`} than the system thought
          </div>
        )}

        <label style={label}>Why — kept on the record</label>
        <input style={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Monday stocktake, a sack split in the store" />

        {error && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #CBD5E1",
                     background: "#fff", color: "#475569", fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" disabled={!valid || busy}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "none",
                     background: "#0A5BAE", color: "#fff", fontWeight: 600,
                     cursor: valid && !busy ? "pointer" : "not-allowed", opacity: valid && !busy ? 1 : 0.6 }}>
            {busy ? "Saving…" : "Save count"}
          </button>
        </div>
      </form>
    </div>
  );
}
