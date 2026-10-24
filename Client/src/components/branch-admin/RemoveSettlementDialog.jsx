import React, { useEffect, useState } from "react";
import { removeSettlementRecord, getDiscountApproval } from "../../services/api";

const money = (n) => `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input = { width: "100%", height: 38, border: "1px solid #D0D5DD", borderRadius: 8, padding: "0 10px", fontSize: 13, marginTop: 4, boxSizing: "border-box" };
const btn = (danger) => ({
  flex: 1, border: danger ? "none" : "1px solid #D0D5DD", background: danger ? "#DC2626" : "#fff",
  color: danger ? "#fff" : "#344054", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
});

/**
 * Remove a cash-on-delivery hand-over or a credit payment recorded by mistake
 * (Administrators). The orders it paid for go back to unpaid. A reason always;
 * the approval PIN only once the owner has set one.
 *
 * @param {"cod"|"credit"} kind
 * @param {{settlement_id:number, amount:number, method:string, who:string, orders?:string}} record
 */
export default function RemoveSettlementDialog({ kind, record, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [pinNeeded, setPinNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDiscountApproval().then((r) => setPinNeeded(Boolean(r?.pin_needed))).catch(() => setPinNeeded(true));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) { setError("Write why this payment is being removed."); return; }
    if (pinNeeded && !/^\d{4,8}$/.test(pin)) { setError("Enter the PIN (4 to 8 digits)."); return; }
    setBusy(true); setError("");
    try {
      const r = await removeSettlementRecord(kind, record.settlement_id, { reason: reason.trim(), pin });
      onDone?.(r);
    } catch (err) {
      setBusy(false); setPin("");
      setError(err?.response?.data?.message || err?.response?.data?.error || "Could not remove the payment.");
    }
  };

  const what = kind === "cod" ? "cash-on-delivery hand-over" : "credit payment";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
      <form onSubmit={submit} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, padding: 24 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1E293B" }}>Remove this {what}?</h3>
        <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
          {money(record.amount)} · {String(record.method || "").replace(/_/g, " ")} · {record.who}
          {record.orders ? ` · ${record.orders}` : ""}
        </p>
        <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px", marginBottom: 14, lineHeight: 1.5 }}>
          For a payment recorded by mistake — the wrong orders, the wrong amount, or money that was not actually
          handed over. The orders it paid for become <strong>unpaid again</strong>, so they show as owed and leave the
          takings until the money really comes in. Your name and the reason go in the Activity Log.
        </div>
        <label style={{ display: "block", fontSize: 12.5, color: "#344054", fontWeight: 600, marginBottom: 12 }}>Reason
          <input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. rider had not paid yet / wrong orders" style={input} />
        </label>
        {pinNeeded && (
          <label style={{ display: "block", fontSize: 12.5, color: "#344054", fontWeight: 600 }}>PIN
            <input type="password" inputMode="numeric" autoComplete="off" value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} style={{ ...input, letterSpacing: 4 }} />
          </label>
        )}
        {error && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "#B91C1C" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btn(false)}>Keep it</button>
          <button type="submit" disabled={busy} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>
            {busy ? "Removing…" : "Remove payment"}
          </button>
        </div>
      </form>
    </div>
  );
}
