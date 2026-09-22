import React, { useState } from "react";

const overlay = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)",
};
const box = {
  background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 420,
  boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
};
const field = {
  width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #CBD5E1",
  fontSize: 15, outline: "none", boxSizing: "border-box", marginTop: 6,
};
const show = (n) => String(Number(Number(n || 0).toFixed(3)));

/**
 * Bring more of an item across from the main store to this branch's shelf.
 * Shows both sides so the owner sees what is left in the store before saying yes.
 */
export default function RestockModal({ title, onShelf, inMain, onSave, onClose }) {
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const value = Number(qty);
  const numberOk = qty !== "" && Number.isInteger(value) && value >= 1;
  const tooMany = numberOk && value > Number(inMain);
  const valid = numberOk && !tooMany;

  const save = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Could not move them");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <form style={box} onSubmit={save} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>Restock {title}</h3>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748B" }}>
          Move stock from the storeroom onto the menu, ready to sell.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>READY TO SELL</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0F172A" }}>{show(onShelf)}</div>
          </div>
          <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>IN THE STOREROOM</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0F172A" }}>{show(inMain)}</div>
          </div>
        </div>

        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginTop: 16 }}>
          How many to move
          <input style={field} type="number" inputMode="numeric" min="1" step="1" max={inMain}
            value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </label>
        {numberOk && !tooMany && (
          <div style={{ marginTop: 6, fontSize: 13, color: "#047857" }}>
            Ready to sell: {show(Number(onShelf) + value)}. Storeroom keeps {show(Number(inMain) - value)}.
          </div>
        )}
        {tooMany && (
          <div style={{ marginTop: 6, fontSize: 13, color: "#B91C1C" }}>
            The storeroom only has {show(inMain)}. Receive more from a supplier first.
          </div>
        )}
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
            {busy ? "Moving…" : "Restock"}
          </button>
        </div>
      </form>
    </div>
  );
}
