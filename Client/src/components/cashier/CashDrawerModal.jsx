import React, { useEffect, useState } from "react";
import {
  getCashSession, openCashSession, addCashMovement, closeCashSession,
} from "../../services/api";

/**
 * The cash drawer: open a shift with a counted float, move money in or out
 * during it, and count it down at the end.
 *
 * The one rule this screen exists to enforce: **the cashier types what they
 * counted before they are shown what was expected.** Showing the target first
 * turns a count into a copy, and a drawer that always balances to the rupee
 * tells the owner nothing at all. The expected figure only appears in the
 * result, once the count is committed.
 */

const money = (n) =>
  `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const box = {
  position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
  background: "rgba(15,23,42,0.45)", padding: 16,
};
const card = {
  width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto",
  background: "#fff", borderRadius: 16, padding: 24,
  boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
};
const input = {
  width: "100%", padding: "12px 14px", fontSize: 16, borderRadius: 10,
  border: "1px solid #CBD5E1", outline: "none", boxSizing: "border-box",
};
const btn = (kind) => ({
  flex: 1, padding: "12px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600,
  cursor: "pointer", border: kind === "ghost" ? "1px solid #CBD5E1" : "none",
  background: kind === "ghost" ? "#fff" : kind === "danger" ? "#DC2626" : "#0A5BAE",
  color: kind === "ghost" ? "#475569" : "#fff",
});
const row = { display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 14 };

// What a pay-out from the till can be for. All but the last become an expense
// in the owner's accounts; a supplier's invoice is recorded against its
// purchase order on the Suppliers page instead, so it is not counted twice.
const PAYOUT_CATEGORIES = [
  ["utilities", "A bill — electricity, water, gas, phone"],
  ["raw_materials", "Food or ingredients bought for cash"],
  ["maintenance", "Repairs and maintenance"],
  ["delivery", "Delivery or transport"],
  ["marketing", "Marketing"],
  ["salary", "Wages paid in cash"],
  ["other", "Something else"],
  ["supplier", "A supplier's invoice (also record it on the Suppliers page)"],
];

export default function CashDrawerModal({ branchId, onClose, onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("loading");   // loading | open | shift | close | result
  const [result, setResult] = useState(null);

  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [needsPin, setNeedsPin] = useState(false);

  const [mvKind, setMvKind] = useState("pay_out");
  const [mvAmount, setMvAmount] = useState("");
  const [mvReason, setMvReason] = useState("");
  const [mvCategory, setMvCategory] = useState("");

  // The drawer opens only with its PIN. Once it is right it is kept here, for
  // this visit only, and sent with every drawer action.
  const [unlockPin, setUnlockPin] = useState("");
  const [pinEntry, setPinEntry] = useState("");

  const load = async (p = unlockPin) => {
    setError("");
    try {
      const s = await getCashSession(branchId, p || undefined);
      if (s.locked) {
        setView(s.pin_set === false ? "nopin" : "pin");
        return;
      }
      setState(s);
      setView(s.open ? "shift" : "open");
    } catch (e) {
      setError(e?.response?.data?.message || "Could not read the drawer");
      // A PIN that stopped working (the manager changed it) goes back to the lock.
      setView([403, 423, 429].includes(e?.response?.status) ? "pin" : "open");
    }
  };

  const unlock = async (e) => {
    e?.preventDefault?.();
    if (pinEntry.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const s = await getCashSession(branchId, pinEntry);
      if (s.locked) {
        setView(s.pin_set === false ? "nopin" : "pin");
        return;
      }
      setUnlockPin(pinEntry);
      setState(s);
      setView(s.open ? "shift" : "open");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not check that PIN");
    } finally {
      setPinEntry("");
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId]);

  const fail = (e, fallback) =>
    setError(e?.response?.data?.error || e?.response?.data?.message || fallback);

  const doOpen = async () => {
    setBusy(true); setError("");
    try {
      await openCashSession({ b_id: branchId, opening_float: Number(float || 0) }, unlockPin);
      setFloat("");
      await load();
      onChanged?.();
    } catch (e) { fail(e, "Could not open the drawer"); }
    finally { setBusy(false); }
  };

  const doMovement = async () => {
    setBusy(true); setError("");
    try {
      await addCashMovement({
        b_id: branchId, kind: mvKind,
        amount: Number(mvAmount || 0), reason: mvReason.trim(),
        ...(mvKind === "pay_out" ? { category: mvCategory } : {}),
      }, unlockPin);
      setMvAmount(""); setMvReason(""); setMvCategory("");
      await load();
      onChanged?.();
    } catch (e) { fail(e, "Could not record that"); }
    finally { setBusy(false); }
  };

  const doClose = async () => {
    setBusy(true); setError("");
    try {
      const r = await closeCashSession({
        b_id: branchId,
        counted_cash: Number(counted || 0),
        notes: notes.trim() || undefined,
        ...(pin ? { approval_pin: pin } : {}),
      }, unlockPin);
      setResult(r);
      setView("result");
      onChanged?.();
    } catch (e) {
      const d = e?.response?.data;
      if (d?.needs_approval) {
        // The count is already in. All that is missing is a manager, and the
        // figure they are approving is named so they know what they are signing.
        setNeedsPin(true);
        setError(d.error || "A manager needs to approve this difference.");
      } else {
        fail(e, "Could not close the drawer");
      }
    } finally { setBusy(false); }
  };

  const t = state?.totals;

  return (
    <div style={box} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={card}>
        {view === "loading" && <div style={{ color: "#64748B" }}>Reading the drawer…</div>}

        {/* ── Locked: the drawer opens only with its PIN ───────────── */}
        {view === "pin" && (
          <form onSubmit={unlock}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              Drawer PIN
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, marginTop: 6 }}>
              The cash drawer opens only with its PIN. Ask the manager if you do not have it.
            </p>
            <input style={{ ...input, marginTop: 14, textAlign: "center", fontSize: 24, letterSpacing: 8 }}
              type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8}
              value={pinEntry} onChange={(e) => setPinEntry(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="••••" />
            {error && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" style={btn("ghost")} onClick={onClose}>Back to the till</button>
              <button type="submit" style={btn()} disabled={busy || pinEntry.length < 4}>
                {busy ? "Checking…" : "Open the drawer"}
              </button>
            </div>
          </form>
        )}

        {view === "nopin" && (
          <>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              The drawer is locked
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, marginTop: 6 }}>
              No drawer PIN has been set yet. The manager sets one on the Hotel Profile page;
              until then the drawer stays closed. Sales still go through as normal.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={btn()} onClick={onClose}>Back to the till</button>
            </div>
          </>
        )}

        {/* ── No shift open ───────────────────────────────────────────────── */}
        {view === "open" && (
          <>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              Start the day
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, marginTop: 6 }}>
              Count the money already in the drawer and enter the total. Everything
              you take today is measured against it.
            </p>
            <label style={{ display: "block", marginTop: 18, fontSize: 13, fontWeight: 600, color: "#334155" }}>
              Opening float
            </label>
            <input style={{ ...input, marginTop: 6 }} type="number" inputMode="decimal"
              autoFocus value={float} onChange={(e) => setFloat(e.target.value)}
              placeholder="0.00" />
            {error && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={btn("ghost")} onClick={onClose}>Not now</button>
              <button style={btn()} disabled={busy || float === ""} onClick={doOpen}>
                {busy ? "Opening…" : "Open the drawer"}
              </button>
            </div>
          </>
        )}

        {/* ── Shift in progress ───────────────────────────────────────────── */}
        {view === "shift" && state?.open && (
          <>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              The drawer
            </h2>
            <p style={{ color: "#64748B", fontSize: 13, marginTop: 4 }}>
              Opened with {money(state.session.opening_float)}
            </p>

            <div style={{ marginTop: 16, padding: 14, background: "#F8FAFC", borderRadius: 12 }}>
              <div style={row}><span>Opening float</span><strong>{money(state.session.opening_float)}</strong></div>
              <div style={row}><span>Cash sales <span style={{ color: "#94A3B8" }}>({t.cash_orders})</span></span>
                <strong>{money(t.cash_sales)}</strong></div>
              {t.hotel_cash_payments > 0 && (
                <div style={row}><span>Room payments taken <span style={{ color: "#94A3B8" }}>({t.hotel_cash_payments})</span></span>
                  <strong>{money(t.hotel_cash_in)}</strong></div>
              )}
              {t.hotel_cash_refunds > 0 && (
                <div style={row}><span>Room refunds handed back</span><strong>−{money(t.hotel_cash_refunds)}</strong></div>
              )}
              {t.pay_in > 0 && <div style={row}><span>Put in</span><strong>{money(t.pay_in)}</strong></div>}
              {t.pay_out > 0 && <div style={row}><span>Paid out</span><strong>−{money(t.pay_out)}</strong></div>}
              {t.drops > 0 && <div style={row}><span>Dropped to the safe</span><strong>−{money(t.drops)}</strong></div>}
              <div style={{ ...row, borderTop: "1px solid #E2E8F0", marginTop: 6, paddingTop: 10, fontSize: 15 }}>
                <strong>Should be in the drawer</strong>
                <strong style={{ color: "#0A5BAE" }}>{money(state.expected_cash)}</strong>
              </div>
            </div>

            {/* Card takings are shown so a cashier is not surprised the drawer
                does not hold them — they were never notes. */}
            {t.non_cash_sales > 0 && (
              <div style={{ ...row, color: "#64748B", fontSize: 13 }}>
                <span>Card and other, not in the drawer</span><span>{money(t.non_cash_sales)}</span>
              </div>
            )}
            {t.voided_orders > 0 && (
              <div style={{ ...row, color: "#B91C1C", fontSize: 13 }}>
                <span>Voided ({t.voided_orders})</span><span>{money(t.voided_value)}</span>
              </div>
            )}
            {state.unassigned_cash?.orders > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, fontSize: 13,
                            background: "#FEF3C7", color: "#92400E" }}>
                {state.unassigned_cash.orders} cash sale(s) worth {money(state.unassigned_cash.value)} were
                rung up with no drawer open, so they are not counted here.
              </div>
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                Money in or out
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select style={{ ...input, width: 130 }} value={mvKind} onChange={(e) => setMvKind(e.target.value)}>
                  <option value="pay_out">Pay out</option>
                  <option value="pay_in">Put in</option>
                  <option value="drop">Drop to safe</option>
                </select>
                <input style={{ ...input, width: 110 }} type="number" inputMode="decimal"
                  value={mvAmount} onChange={(e) => setMvAmount(e.target.value)} placeholder="Amount" />
                <input style={input} value={mvReason} onChange={(e) => setMvReason(e.target.value)}
                  placeholder="What for?" />
              </div>
              {/* Money spent from the till on a bill is an expense: saying what it
                  was for puts it in the owner's accounts as well as the drawer. */}
              {mvKind === "pay_out" && (
                <select style={{ ...input, marginTop: 8 }} value={mvCategory}
                  onChange={(e) => setMvCategory(e.target.value)}>
                  <option value="">What was it spent on?</option>
                  {PAYOUT_CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              )}
              <button style={{ ...btn("ghost"), marginTop: 8, width: "100%", flex: "none" }}
                disabled={busy || !mvAmount || !mvReason.trim() || (mvKind === "pay_out" && !mvCategory)}
                onClick={doMovement}>
                Record it
              </button>
            </div>

            {error && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{error}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={btn("ghost")} onClick={onClose}>Back to the till</button>
              <button style={btn()} onClick={() => { setError(""); setView("close"); }}>
                Count and close
              </button>
            </div>
          </>
        )}

        {/* ── Counting down ───────────────────────────────────────────────── */}
        {view === "close" && (
          <>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              Count the drawer
            </h2>
            <p style={{ color: "#64748B", fontSize: 14, marginTop: 6 }}>
              Take everything out and count it. Enter the total — the system will
              then tell you what it expected.
            </p>
            {/* Deliberately no expected figure on this screen. */}

            <label style={{ display: "block", marginTop: 18, fontSize: 13, fontWeight: 600, color: "#334155" }}>
              Counted cash
            </label>
            <input style={{ ...input, marginTop: 6, fontSize: 22, textAlign: "center", letterSpacing: 1 }}
              type="number" inputMode="decimal" autoFocus
              value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0.00" />

            <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 600, color: "#334155" }}>
              Anything worth noting? <span style={{ fontWeight: 400, color: "#94A3B8" }}>(optional)</span>
            </label>
            <input style={{ ...input, marginTop: 6 }} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="e.g. counted twice" />

            {needsPin && (
              <>
                <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 600, color: "#B91C1C" }}>
                  Manager's PIN
                </label>
                <input style={{ ...input, marginTop: 6, textAlign: "center", letterSpacing: "0.4em" }}
                  type="password" inputMode="numeric" value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
              </>
            )}

            {error && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{error}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={btn("ghost")} onClick={() => { setView("shift"); setError(""); setNeedsPin(false); }}>
                Back
              </button>
              <button style={btn()} disabled={busy || counted === "" || (needsPin && !pin)} onClick={doClose}>
                {busy ? "Closing…" : "Close the drawer"}
              </button>
            </div>
          </>
        )}

        {/* ── The verdict ─────────────────────────────────────────────────── */}
        {view === "result" && result && (
          <>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0F172A" }}>
              Drawer closed
            </h2>
            <div style={{ marginTop: 16, padding: 14, background: "#F8FAFC", borderRadius: 12 }}>
              <div style={row}><span>You counted</span><strong>{money(result.session.counted_cash)}</strong></div>
              <div style={row}><span>Expected</span><strong>{money(result.expected_cash)}</strong></div>
              <div style={{ ...row, borderTop: "1px solid #E2E8F0", marginTop: 6, paddingTop: 10, fontSize: 16 }}>
                <strong>Difference</strong>
                <strong style={{
                  color: result.verdict.state === "balanced" ? "#047857"
                       : result.verdict.state === "short" ? "#B91C1C" : "#B45309",
                }}>
                  {result.variance > 0 ? "+" : ""}{money(result.variance)}
                </strong>
              </div>
            </div>
            <p style={{
              marginTop: 14, padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: result.verdict.state === "balanced" ? "#ECFDF5"
                        : result.verdict.state === "short" ? "#FEF2F2" : "#FFFBEB",
              color: result.verdict.state === "balanced" ? "#047857"
                   : result.verdict.state === "short" ? "#B91C1C" : "#B45309",
            }}>
              {result.verdict.text}
            </p>
            <button style={{ ...btn(), marginTop: 8, width: "100%" }} onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
