import React, { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getReportSummary, getReportTransactions } from "../../services/api";
import { card, input, label, btn, th, td, errorBox, money, dmy, ymd, addDays, today } from "./ui";
import { DOCUMENT_LOGO, hideIfMissing } from "../../brand";
import { dayKey } from "../../utils/dates";

const PRESETS = [
  ["Today",        () => [today(), today()]],
  ["Last 7 days",  () => [ymd(addDays(new Date(), -6)), today()]],
  ["Last 30 days", () => [ymd(addDays(new Date(), -29)), today()]],
  ["This month",   () => [ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), today()]],
  ["This year",    () => [`${new Date().getFullYear()}-01-01`, today()]],
];

const CAT_LABEL = {
  supplier_payments: "Paid to suppliers",
  utilities: "Utilities", salary: "Salary", raw_materials: "Raw Materials",
  commission: "Commission", maintenance: "Maintenance", marketing: "Marketing",
  delivery: "Delivery", food_packets: "Food Packets", other: "Other",
};

export default function Reports() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)));
  const [to, setTo] = useState(today());
  const [preset, setPreset] = useState("Last 30 days");
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [tab, setTab] = useState("overview");
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!branchId) return;
    setLoading(true); setError("");
    try {
      const [s, t] = await Promise.all([
        getReportSummary({ b_id: branchId, from, to }),
        getReportTransactions({ b_id: branchId, from, to, kind }),
      ]);
      setData(s); setLedger(t);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load reports");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId, from, to, kind]);

  const applyPreset = (name, fn) => { const [f, t] = fn(); setPreset(name); setFrom(f); setTo(t); };

  const exportCsv = () => {
    if (!ledger?.transactions?.length) return;
    const head = ["Date", "Time", "Type", "Direction", "Amount", "Method", "Reference", "Party", "Handled by"];
    const clock = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5); };
    // Excel turns a bare 2026-09-21 into a date wider than a default column and shows
    // ######## — the day was in the file but not on screen. Written as text it stays legible.
    const rows = ledger.transactions.map(t => [
      `="${dayKey(t.at)}"`, clock(t.at), t.type, t.direction,
      t.amount, t.method || "", t.reference || "", t.party || "", t.handled_by || "",
    ]);
    const cell = (c) => (typeof c === "string" && c.startsWith('="') ? c : `"${String(c).replace(/"/g, '""')}"`);
    const csv = "\uFEFF" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `report_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const maxDay = useMemo(() => {
    if (!data?.daily?.length) return 0;
    return Math.max(...data.daily.map(d => Math.max(d.revenue, d.expenses)));
  }, [data]);

  const tabStyle = (t) => ({
    padding: "10px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14,
    fontWeight: tab === t ? 700 : 400, color: tab === t ? "#1565C0" : "#64748B",
    borderBottom: tab === t ? "2px solid #1565C0" : "2px solid transparent",
  });

  return (
    <AppShell title="Reports">
      <img src={DOCUMENT_LOGO} alt="" onError={hideIfMissing}
        style={{ maxHeight: 56, maxWidth: 220, objectFit: "contain", marginBottom: 16, display: "block" }} />
      {error && <div style={errorBox}>{error}</div>}

      {/* Range controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        {PRESETS.map(([name, fn]) => (
          <button key={name} onClick={() => applyPreset(name, fn)}
            style={{
              padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: preset === name ? "1px solid #1565C0" : "1px solid #E2E8F0",
              background: preset === name ? "#1565C0" : "#fff",
              color: preset === name ? "#fff" : "#64748B",
            }}>{name}</button>
        ))}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 6 }}>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset("Custom"); }}
            style={{ ...input, width: 150 }} />
          <span style={{ color: "#94A3B8" }}>→</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset("Custom"); }}
            style={{ ...input, width: 150 }} />
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={exportCsv} disabled={!ledger?.transactions?.length} style={btn("ghost")}>
          Export CSV
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading reports…</div>
      ) : !data ? null : (
        <>
          {/* Headline numbers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 22 }}>
            {[
              ["Total Revenue", money(data.revenue.total), "#065F46", "#D1FAE5", `${data.range.days} day(s)`],
              ["Expenses", money(data.expenses.total + data.expenses.commissions), "#B91C1C", "#FEE2E2",
                `incl. ${money(data.expenses.commissions)} commission`],
              ["Net Profit", money(data.profit.net),
                data.profit.net >= 0 ? "#1565C0" : "#B91C1C", "#EFF6FF", `${data.profit.margin_pct}% margin`],
              ["Occupancy", `${data.occupancy.occupancy_pct}%`, "#6B21A8", "#F3E8FF",
                `${data.occupancy.rooms_sold} of ${data.occupancy.rooms_available} room-nights`],
            ].map(([k, v, fg, bg, sub]) => (
              <div key={k} style={{ background: bg, borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: fg, margin: "5px 0 2px" }}>{v}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, overflow: "hidden" }}>
            <div style={{ display: "flex", borderBottom: "1px solid #E2E8F0", paddingLeft: 8 }}>
              <button onClick={() => setTab("overview")} style={tabStyle("overview")}>Overview</button>
              <button onClick={() => setTab("daily")}    style={tabStyle("daily")}>Daily Breakdown</button>
              <button onClick={() => setTab("ledger")}   style={tabStyle("ledger")}>Transactions</button>
            </div>

            {/* Overview */}
            {tab === "overview" && (
              <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 14 }}>Revenue Split</div>
                  {[
                    ["Hotel (rooms, meals, room service)", data.revenue.hotel, "#1565C0"],
                    ["Restaurant (walk-in)", data.revenue.restaurant, "#F59E0B"],
                  ].map(([k, v, c]) => {
                    const pct = data.revenue.total ? (v / data.revenue.total) * 100 : 0;
                    return (
                      <div key={k} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                          <span style={{ color: "#475569" }}>{k}</span>
                          <span style={{ fontWeight: 700, color: "#1E293B" }}>
                            {money(v)} <span style={{ color: "#94A3B8", fontSize: 11 }}>({pct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div style={{ background: "#F1F5F9", borderRadius: 4, height: 9 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: c, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 24, background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B", marginBottom: 10 }}>Hotel Performance</div>
                    {[
                      ["ADR (average daily rate)", money(data.occupancy.adr)],
                      ["RevPAR (revenue per available room)", money(data.occupancy.revpar)],
                      ["Room-nights sold", data.occupancy.rooms_sold],
                      ["Restaurant orders", data.restaurant_orders],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                        <span style={{ color: "#64748B" }}>{k}</span>
                        <span style={{ color: "#1E293B", fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 14 }}>Expenses by Category</div>
                  {data.expenses.by_category.length === 0 ? (
                    <div style={{ color: "#94A3B8", fontSize: 13, padding: 16 }}>No expenses in this range.</div>
                  ) : data.expenses.by_category.map(c => {
                    const pct = data.expenses.total ? (Number(c.total) / data.expenses.total) * 100 : 0;
                    return (
                      <div key={c.exp_category} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                          <span style={{ color: "#475569" }}>{CAT_LABEL[c.exp_category] || c.exp_category}</span>
                          <span style={{ fontWeight: 700, color: "#1E293B" }}>{money(c.total)}</span>
                        </div>
                        <div style={{ background: "#F1F5F9", borderRadius: 4, height: 8 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#EF4444", borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 24, background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B", marginBottom: 10 }}>Profit & Loss</div>
                    {[
                      ["Hotel revenue", money(data.revenue.hotel), "#065F46"],
                      ["Restaurant revenue", money(data.revenue.restaurant), "#065F46"],
                      ["Operating expenses", `(${money(data.expenses.total)})`, "#B91C1C"],
                      ["Agent commissions", `(${money(data.expenses.commissions)})`, "#B91C1C"],
                    ].map(([k, v, c]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between",
                                            padding: "5px 0", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                        <span style={{ color: "#64748B" }}>{k}</span>
                        <span style={{ color: c, fontWeight: 600 }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontSize: 15, fontWeight: 700 }}>
                      <span style={{ color: "#1E293B" }}>Net Profit</span>
                      <span style={{ color: data.profit.net >= 0 ? "#1565C0" : "#B91C1C" }}>{money(data.profit.net)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Daily */}
            {tab === "daily" && (
              <div style={{ padding: 24 }}>
                {data.daily.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#94A3B8", padding: 30 }}>No activity in this range.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 170, marginBottom: 24, overflowX: "auto" }}>
                      {data.daily.map(d => (
                        <div key={d.day} style={{ flex: "1 0 26px", display: "flex", flexDirection: "column",
                                                  alignItems: "center", gap: 3, minWidth: 26 }}>
                          <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 130 }}>
                            <div title={`Revenue ${money(d.revenue)}`}
                              style={{ width: 9, background: "#1565C0", borderRadius: "3px 3px 0 0",
                                       height: maxDay ? `${(d.revenue / maxDay) * 130}px` : 0, minHeight: d.revenue ? 3 : 0 }} />
                            <div title={`Expenses ${money(d.expenses)}`}
                              style={{ width: 9, background: "#EF4444", borderRadius: "3px 3px 0 0",
                                       height: maxDay ? `${(d.expenses / maxDay) * 130}px` : 0, minHeight: d.expenses ? 3 : 0 }} />
                          </div>
                          <div style={{ fontSize: 9, color: "#94A3B8", whiteSpace: "nowrap" }}>{d.day.slice(5)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748B", marginBottom: 18 }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#1565C0", borderRadius: 2, marginRight: 5 }} />Revenue</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#EF4444", borderRadius: 2, marginRight: 5 }} />Expenses</span>
                    </div>

                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#F8FAFC" }}>
                        {["Date", "Hotel", "Restaurant", "Revenue", "Expenses", "Profit"].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {[...data.daily].reverse().map(d => (
                          <tr key={d.day} style={{ borderTop: "1px solid #F1F5F9" }}>
                            <td style={{ ...td, fontWeight: 600, color: "#1E293B" }}>{dmy(d.day)}</td>
                            <td style={td}>{money(d.hotel)}</td>
                            <td style={td}>{money(d.restaurant)}</td>
                            <td style={{ ...td, fontWeight: 600, color: "#065F46" }}>{money(d.revenue)}</td>
                            <td style={{ ...td, color: "#B91C1C" }}>{money(d.expenses)}</td>
                            <td style={{ ...td, fontWeight: 700, color: d.profit >= 0 ? "#1565C0" : "#B91C1C" }}>{money(d.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}

            {/* Ledger */}
            {tab === "ledger" && (
              <div>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex",
                              gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {[["all", "All"], ["hotel", "Hotel"], ["restaurant", "Restaurant"],
                    ["expense", "Expenses"], ["commission", "Commissions"]].map(([k, l]) => (
                    <button key={k} onClick={() => setKind(k)}
                      style={{
                        padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                        border: kind === k ? "1px solid #1565C0" : "1px solid #E2E8F0",
                        background: kind === k ? "#EFF6FF" : "#fff",
                        color: kind === k ? "#1565C0" : "#64748B", fontWeight: kind === k ? 600 : 400,
                      }}>{l}</button>
                  ))}
                  <div style={{ flex: 1 }} />
                  {ledger && (
                    <div style={{ fontSize: 12, color: "#64748B" }}>
                      In <strong style={{ color: "#059669" }}>{money(ledger.totals.in)}</strong> ·
                      Out <strong style={{ color: "#B91C1C" }}> {money(ledger.totals.out)}</strong> ·
                      Net <strong style={{ color: "#1565C0" }}> {money(ledger.totals.net)}</strong>
                    </div>
                  )}
                </div>
                {!ledger?.transactions?.length ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>No transactions in this range.</div>
                ) : (
                  <div style={{ maxHeight: 460, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#F8FAFC", position: "sticky", top: 0 }}>
                        {["Date", "Type", "Party", "Reference", "Method", "Amount"].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {ledger.transactions.map((t, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #F1F5F9" }}>
                            <td style={td}>{dmy(t.at)}</td>
                            <td style={td}>{t.type}</td>
                            <td style={{ ...td, color: "#1E293B" }}>{t.party || "—"}</td>
                            <td style={{ ...td, color: "#94A3B8" }}>{t.reference || "—"}</td>
                            <td style={{ ...td, textTransform: "capitalize" }}>{(t.method || "—").replace(/_/g, " ")}</td>
                            <td style={{ ...td, fontWeight: 700, color: t.direction === "in" ? "#059669" : "#B91C1C" }}>
                              {t.direction === "in" ? "+" : "−"}{money(t.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
