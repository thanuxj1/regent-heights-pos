import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import StatCard from "../../components/branch-admin/StatCard";
import { getOutstandingCredit, getCreditHistory, settleCredit } from "../../services/api";
import { todayKey } from "../../utils/dates";

/**
 * Credit sales: food given at the till to someone the house knows, who pays
 * later. Nothing here is revenue until it is paid; recording the payment is what
 * puts it into the reports, on the day it is paid.
 */

const money = (n) => `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const METHOD_LABEL = { cash: "Cash", card: "Card", bank_transfer: "Bank transfer", online: "Online", other: "Other" };

const card = { background: "#fff", border: "1px solid #E4E7EC", borderRadius: 16, padding: 20, marginBottom: 20 };
const th = { textAlign: "left", padding: "10px 12px", fontSize: 12, color: "#64748B", fontWeight: 600, borderBottom: "1px solid #E4E7EC" };
const td = { padding: "10px 12px", fontSize: 13, color: "#1E293B", borderBottom: "1px solid #F1F5F9" };
const input = { width: "100%", height: 38, border: "1px solid #D0D5DD", borderRadius: 8, padding: "0 10px", fontSize: 13, marginTop: 4 };
const btn = (primary) => ({
  border: primary ? "none" : "1px solid #D0D5DD", background: primary ? "#1565C0" : "#fff", color: primary ? "#fff" : "#344054",
  borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
});

export default function CreditSales() {
  const [data, setData] = useState({ orders: [], by_customer: [], total: 0 });
  const [history, setHistory] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [paying, setPaying] = useState(null); // the customer whose payment is being recorded
  const [picked, setPicked] = useState(new Set());
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState(todayKey());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = async () => {
    try {
      setLoadError("");
      const [o, h] = await Promise.all([getOutstandingCredit(), getCreditHistory()]);
      setData(o);
      setHistory(h);
    } catch (e) {
      setLoadError(e?.response?.data?.message || "Could not load credit sales.");
    }
  };
  useEffect(() => { load(); }, []);

  const ordersOf = (c) => data.orders.filter(
    (o) => (o.credit_customer || "").trim().toLowerCase() === (c.customer || "").trim().toLowerCase()
      && (o.credit_phone || "") === (c.phone || ""));

  const openPay = (c) => {
    setPaying(c);
    setPicked(new Set(ordersOf(c).map((o) => o.or_id)));
    setMethod("cash"); setPaidOn(todayKey()); setNote(""); setError(""); setDone("");
  };

  const pickedTotal = useMemo(
    () => data.orders.filter((o) => picked.has(o.or_id)).reduce((s, o) => s + Number(o.amount || 0), 0),
    [data.orders, picked]);

  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const record = async () => {
    if (!picked.size) { setError("Tick the orders they are paying for."); return; }
    try {
      setSaving(true); setError("");
      const r = await settleCredit({ order_ids: [...picked], method, settled_date: paidOn, note });
      setDone(`${paying.customer} paid ${money(r.amount)} by ${METHOD_LABEL[method] || method}.`);
      setPaying(null);
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e?.response?.data?.error || "Could not record the payment.");
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Credit Sales" />
        <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {loadError && <div style={{ ...card, background: "#FEF2F2", borderColor: "#FECACA", color: "#B91C1C", padding: "10px 14px" }}>{loadError}</div>}
          {done && <div style={{ ...card, background: "#ECFDF3", borderColor: "#ABEFC6", color: "#067647", padding: "10px 14px" }}>{done}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 20 }}>
            <StatCard title="Owed to us" value={money(data.total)} subtitle="Credit not yet paid — not in revenue until it is" icon="🧾" iconClass="bg-violet-100 text-violet-700" showAction={false} onClick={() => {}} />
            <StatCard title="Customers owing" value={data.by_customer.length} icon="👤" iconClass="bg-amber-100 text-amber-700" showAction={false} onClick={() => {}} />
            <StatCard title="Unpaid credit bills" value={data.orders.length} icon="📄" iconClass="bg-sky-100 text-sky-700" showAction={false} onClick={() => {}} />
          </div>

          <div style={card}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#1E293B" }}>Who owes us</h2>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#64748B" }}>
              Choose <strong>Credit</strong> as the payment at the till to give food on credit. When the customer pays, record it here.
            </p>
            {data.by_customer.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Nobody owes anything on credit.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Customer</th><th style={th}>Phone</th><th style={th}>Unpaid bills</th>
                  <th style={th}>Oldest</th><th style={{ ...th, textAlign: "right" }}>Owes</th><th style={th} />
                </tr></thead>
                <tbody>
                  {data.by_customer.map((c) => (
                    <tr key={c.key}>
                      <td style={{ ...td, fontWeight: 600 }}>{c.customer}</td>
                      <td style={td}>{c.phone || "—"}</td>
                      <td style={td}>{c.count}</td>
                      <td style={td}>{day(c.oldest)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#B91C1C" }}>{money(c.total)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button type="button" style={btn(true)} onClick={() => openPay(c)}>Record payment</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={card}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#1E293B" }}>Payments received</h2>
            {history.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>No credit payments yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Paid on</th><th style={th}>Customer</th><th style={th}>Bills</th><th style={th}>Method</th>
                  <th style={th}>Note</th><th style={th}>Recorded by</th><th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.settlement_id}>
                      <td style={td}>{day(h.settled_date)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{h.customer_name || "—"}</td>
                      <td style={td}>{h.orders || "—"}</td>
                      <td style={td}>{METHOD_LABEL[h.method] || h.method}</td>
                      <td style={td}>{h.note || "—"}</td>
                      <td style={td}>{h.recorded_by || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(h.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      {paying && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 24 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "#1E293B" }}>{paying.customer} is paying</h3>
            <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#64748B" }}>Tick the bills they are paying for. Each bill is paid in full.</p>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
              <tbody>
                {ordersOf(paying).map((o) => (
                  <tr key={o.or_id} onClick={() => toggle(o.or_id)} style={{ cursor: "pointer" }}>
                    <td style={{ ...td, width: 30 }}>
                      <input type="checkbox" aria-label={`Bill #${o.or_id}`} checked={picked.has(o.or_id)} onChange={() => toggle(o.or_id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td style={td}>Bill #{o.or_id}</td>
                    <td style={td}>{day(o.or_date)}</td>
                    <td style={td}>{o.sold_by || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12.5, color: "#344054", fontWeight: 600 }}>Paid by
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={input}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <label style={{ fontSize: 12.5, color: "#344054", fontWeight: 600 }}>Paid on
                <input type="date" value={paidOn} max={todayKey()} onChange={(e) => setPaidOn(e.target.value)} style={input} />
              </label>
            </div>
            <label style={{ display: "block", fontSize: 12.5, color: "#344054", fontWeight: 600, marginBottom: 16 }}>Note (optional)
              <input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank reference" style={input} />
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1E293B" }}>Total: {money(pickedTotal)}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={btn(false)} onClick={() => setPaying(null)} disabled={saving}>Cancel</button>
                <button type="button" style={btn(true)} onClick={record} disabled={saving || !picked.size}>
                  {saving ? "Saving…" : "Record payment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
