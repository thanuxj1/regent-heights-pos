import React, { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getReportSummary, getReportTransactions, getReportProducts, getReportPurchases, getReportPayables } from "../../services/api";
import { card, input, label, btn, th, td, errorBox, money, dmy, ymd, addDays, today } from "./ui";
import { DOCUMENT_LOGO, hideIfMissing } from "../../brand";
import { dayKey } from "../../utils/dates";
import { exportCsv as downloadCsv, dateCell } from "../../utils/exportCsv";

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
  waste: "Wasted raw materials",
};

export default function Reports() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)));
  const [to, setTo] = useState(today());
  const [preset, setPreset] = useState("Last 30 days");
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [prodReport, setProdReport] = useState(null);
  const [payables, setPayables] = useState(null);
  const [prodSort, setProdSort] = useState("sales");
  const [tab, setTab] = useState("overview");
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!branchId) return;
    setLoading(true); setError("");
    try {
      const [s, t, p, pay] = await Promise.all([
        getReportSummary({ b_id: branchId, from, to }),
        getReportTransactions({ b_id: branchId, from, to, kind }),
        getReportProducts({ b_id: branchId, from, to }),
        getReportPayables({ b_id: branchId }),
      ]);
      setData(s); setLedger(t); setProdReport(p); setPayables(pay);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load reports");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId, from, to, kind]);

  const applyPreset = (name, fn) => { const [f, t] = fn(); setPreset(name); setFrom(f); setTo(t); };

  const exportCsv = () => {
    if (!ledger?.transactions?.length) return;
    const head = ["Date", "Time", "Type", "Direction", "Amount", "Of which delivery charge", "Method", "Reference", "Party", "Handled by"];
    const clock = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5); };
    const rows = ledger.transactions.map(t => [
      dateCell(dayKey(t.at)), clock(t.at), t.type, t.direction,
      t.amount, t.delivery_charge > 0 ? t.delivery_charge : "", t.method || "", t.reference || "", t.party || "", t.handled_by || "",
    ]);
    downloadCsv(`report_${from}_to_${to}`, head, rows);
  };

  const sortedProducts = useMemo(() => {
    const list = [...(prodReport?.products ?? [])];
    // Lowest margin first for "margin" (the dishes to look at); everything else biggest first.
    return prodSort === "name" ? list.sort((a, b) => a.name.localeCompare(b.name))
      : prodSort === "margin" ? list.sort((a, b) => a.margin_pct - b.margin_pct)
      : list.sort((a, b) => b[prodSort] - a[prodSort]);
  }, [prodReport, prodSort]);

  const exportProductsCsv = () => {
    if (!prodReport?.products?.length) return;
    const head = ["Product", "Category", "Units sold", "Sales", "Cost", "Profit", "Margin %", "Cost price set?"];
    const rows = sortedProducts.map(p => [p.name, p.category || "", p.units, p.sales, p.cost, p.profit, p.margin_pct, p.no_cost_set ? "NO" : "yes"]);
    downloadCsv(`product_profit_${from}_to_${to}`, head, rows);
  };

  // The four reports the owners ask for, each its own file. They are built from the
  // full ledger for the range, whatever the Transactions tab is currently filtered to.
  const fullLedger = async () => (await getReportTransactions({ b_id: branchId, from, to, kind: "all" })).transactions ?? [];
  const clockOf = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5); };
  const methodOf = (m) => (m && m !== "—" ? String(m).replace(/_/g, " ") : "");
  const subtotals = (rows, keyFn) => {
    const by = {};
    rows.forEach(r => { const k = keyFn(r) || "unspecified"; by[k] = (by[k] || 0) + r.signed; });
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  };

  const exportRevenueCsv = async () => {
    const all = (await fullLedger()).filter(t => /^(Hotel payment|Restaurant|Delivery COD)/.test(t.type))
      .map(t => ({ ...t, signed: t.direction === "out" ? -t.amount : t.amount }));
    const head = ["Date", "Time", "Source", "Amount (refunds negative)", "Of which delivery charge", "Payment method", "Reference", "Customer / guest", "Handled by"];
    const rows = all.map(t => [dateCell(dayKey(t.at)), clockOf(t.at), t.type, t.signed,
      t.delivery_charge > 0 ? t.delivery_charge : "", methodOf(t.method), t.reference || "", t.party || "", t.handled_by || ""]);
    rows.push([], ["TOTAL REVENUE", "", "", all.reduce((s, t) => s + t.signed, 0)]);
    rows.push([], ["BY SOURCE"], ...subtotals(all, t => t.type.replace(/\s*\(.*\)/, "")).map(([k, v]) => [k, "", "", v]));
    rows.push([], ["BY PAYMENT METHOD"], ...subtotals(all, t => methodOf(t.method)).map(([k, v]) => [k, "", "", v]));
    downloadCsv(`revenue_${from}_to_${to}`, head, rows);
  };

  const exportExpensesCsv = async () => {
    const all = (await fullLedger()).filter(t => /^(Expense|Commission|Waste)/.test(t.type))
      .map(t => ({ ...t, signed: t.amount }));
    const head = ["Date", "Time", "Type", "Amount", "Description / party", "Reference", "Recorded by"];
    const rows = all.map(t => [dateCell(dayKey(t.at)), clockOf(t.at), t.type, t.amount, t.party || "", t.reference || "", t.handled_by || ""]);
    rows.push([], ["TOTAL EXPENSES", "", "", all.reduce((s, t) => s + t.amount, 0)]);
    rows.push([], ["BY TYPE"], ...subtotals(all, t => t.type).map(([k, v]) => [k, "", "", v]));
    rows.push([], ["Supplier purchases are in the Purchasing report."]);
    downloadCsv(`expenses_${from}_to_${to}`, head, rows);
  };

  const exportPurchasingCsv = async () => {
    const p = await getReportPurchases({ b_id: branchId, from, to });
    const head = ["PO #", "Order date", "Supplier", "Status", "Item", "Qty", "Unit price", "Line total", "PO total", "Paid", "Still owed"];
    const first = new Set();
    const rows = (p.lines ?? []).map(l => {
      const o = (p.orders ?? []).find(x => x.po_id === l.po_id);
      const isFirst = !first.has(l.po_id); first.add(l.po_id);
      return [l.po_id, dateCell(dayKey(l.order_date)), l.supplier, l.status, l.item, l.qty, l.unit_price, l.line_total,
        isFirst ? o?.total : "", isFirst ? o?.paid : "", isFirst ? o?.balance : ""];
    });
    const t = p.totals ?? {};
    rows.push([], ["TOTAL PURCHASED", "", "", "", "", "", "", "", t.purchased], ["TOTAL PAID", "", "", "", "", "", "", "", t.paid], ["STILL OWED TO SUPPLIERS", "", "", "", "", "", "", "", t.owed]);
    downloadCsv(`purchasing_${from}_to_${to}`, head, rows);
  };

  const exportPayablesCsv = () => {
    if (!payables) return;
    const head = ["Owed to", "Kind", "Reference", "Received / earned", "Amount owed", "Days outstanding", "Contact"];
    const rows = [];
    payables.suppliers.forEach(s => {
      s.orders.forEach(o => rows.push([s.supplier, "Supplier", `PO#${o.po_id}`, dateCell(dayKey(o.received_date)), o.balance, o.days_outstanding ?? "", s.contact || ""]));
      rows.push([`${s.supplier} — subtotal`, "", "", "", s.owed]);
    });
    payables.commissions.forEach(c => rows.push([c.agent, "Agent commission", `${c.records} record(s)`, dateCell(dayKey(c.oldest)), c.owed, "", ""]));
    rows.push([], ["OWED TO SUPPLIERS", "", "", "", payables.totals.suppliers], ["OWED TO AGENTS (commission)", "", "", "", payables.totals.commissions], ["TOTAL WE OWE", "", "", "", payables.totals.total]);
    downloadCsv(`who_we_owe_${payables.as_of}`, head, rows);
  };

  const exportSummaryCsv = () => {
    if (!data) return;
    const d = data.by_department;
    const pct = (v) => `${v}%`;
    const head = ["Item", "Amount (LKR)", "Note"];
    const line = (label, value, note = "") => [label, value, note];
    const title = (t) => [t.toUpperCase(), "", ""];
    const totalCosts = data.expenses.total + data.expenses.commissions;
    const rows = [
      line("Profit report", `${from} to ${to}`, `${data.range.days} day(s)`),
      [],
      title("Summary"),
      line("Total revenue", money(data.revenue.total), "Hotel + restaurant"),
      line("Total costs", money(totalCosts), "Everything paid out"),
      line("NET PROFIT", money(data.profit.net), `Revenue minus costs — ${pct(data.profit.margin_pct)} of revenue`),
      [],
      title("Hotel"),
      line("Revenue", money(d.hotel.revenue), "Rooms, meals and room service charged to guests"),
      line("  Agent commissions", money(d.hotel.costs.commissions)),
      line("  Hotel supplies bought", money(d.hotel.costs.supplies_bought), "Cleaning products and other consumables, as paid"),
      line("  Hotel supplies wasted", money(d.hotel.costs.supplies_wasted)),
      line("Hotel costs", money(d.hotel.cost_total)),
      line("HOTEL PROFIT (before shared costs)", money(d.hotel.profit)),
      [],
      title("Restaurant"),
      line("Revenue", money(d.restaurant.revenue), `${d.restaurant.orders} orders`),
      line("  of which delivery charges", money(d.restaurant.delivery_charges ?? 0), "Already included in revenue"),
      line("  Food and drink bought", money(d.restaurant.costs.food_and_drink_bought), "Ingredients and resale products, as paid to suppliers"),
      line("  Food wasted", money(d.restaurant.costs.food_wasted)),
      line("  Raw materials, packaging, delivery costs", money(d.restaurant.costs.raw_materials_packaging_delivery), "Recorded expenses"),
      line("Restaurant costs", money(d.restaurant.cost_total)),
      line("RESTAURANT PROFIT (before shared costs)", money(d.restaurant.profit)),
      line("Dish profit (food sold vs what it cost to make)", money(data.product_profit?.profit ?? 0), `${pct(data.product_profit?.margin_pct ?? 0)} margin — see Product Profit`),
      [],
      title("Shared costs (not split between hotel and restaurant)"),
      ...d.shared.by_category.map(c => line(`  ${CAT_LABEL[c.exp_category] || c.exp_category}`, money(c.total))),
      line("Shared costs", money(d.shared.total), "Nothing says whose these are, so they are not guessed at"),
      [],
      title("How it adds up"),
      line("Hotel profit", money(d.hotel.profit)),
      line("Restaurant profit", money(d.restaurant.profit)),
      line("Less shared costs", money(-d.shared.total)),
      line("NET PROFIT", money(data.profit.net), `${pct(data.profit.margin_pct)} of revenue`),
    ];
    downloadCsv(`profit_report_${from}_to_${to}`, head, rows);
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
        <button onClick={exportRevenueCsv} disabled={!data} style={btn("ghost")}>Revenue report</button>
        <button onClick={exportExpensesCsv} disabled={!data} style={btn("ghost")}>Expenses report</button>
        <button onClick={exportPurchasingCsv} disabled={!data} style={btn("ghost")}>Purchasing report</button>
        <button onClick={exportPayablesCsv} disabled={!payables} style={btn("ghost")}>Who we owe</button>
        <button onClick={exportSummaryCsv} disabled={!data} style={btn("ghost")}>Profit report</button>
        <button onClick={exportCsv} disabled={!ledger?.transactions?.length} style={btn("ghost")}>All transactions</button>
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
              ["Dish Profit", money(data.product_profit?.profit ?? 0), "#92400E", "#FEF3C7",
                `${data.product_profit?.margin_pct ?? 0}% margin on food sold`],
              ["Hotel Profit", money(data.by_department?.hotel.profit ?? 0),
                (data.by_department?.hotel.profit ?? 0) >= 0 ? "#6B21A8" : "#B91C1C", "#F3E8FF",
                `revenue ${money(data.by_department?.hotel.revenue ?? 0)} · before shared costs`],
              ["Restaurant Profit", money(data.by_department?.restaurant.profit ?? 0),
                (data.by_department?.restaurant.profit ?? 0) >= 0 ? "#9A3412" : "#B91C1C", "#FFEDD5",
                `revenue ${money(data.by_department?.restaurant.revenue ?? 0)} · before shared costs`],
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
              <button onClick={() => setTab("products")} style={tabStyle("products")}>Product Profit</button>
              <button onClick={() => setTab("owed")}     style={tabStyle("owed")}>Who We Owe</button>
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
                  {/* Part of the Restaurant figure above, not on top of it — the bars
                      still add up to the total. Shown so delivery income is visible. */}
                  <div style={{ fontSize: 12, color: "#64748B", marginTop: -4 }}>
                    Restaurant includes delivery charges of{" "}
                    <strong style={{ color: "#1E293B" }}>{money(data.revenue.delivery_charges ?? 0)}</strong>
                  </div>

                  {/* Who earned what: each side's own costs, then the costs nobody can
                      assign to one side, then the total that matches Net Profit above. */}
                  <div style={{ marginTop: 24, background: "#F8FAFC", borderRadius: 10, padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B", marginBottom: 10 }}>Profit by department</div>
                    {data.by_department && [
                      ["Hotel", data.by_department.hotel, "#6B21A8"],
                      ["Restaurant", data.by_department.restaurant, "#9A3412"],
                    ].map(([name, dep, color]) => (
                      <div key={name} style={{ padding: "6px 0", borderBottom: "1px solid #E2E8F0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color }}>
                          <span>{name}</span><span>{money(dep.profit)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#64748B" }}>
                          Revenue {money(dep.revenue)} − its own costs {money(dep.cost_total)}
                        </div>
                      </div>
                    ))}
                    {data.by_department && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", fontSize: 13 }}>
                          <span style={{ color: "#64748B" }}>Shared costs (utilities, salaries, …)</span>
                          <span style={{ color: "#B91C1C", fontWeight: 600 }}>−{money(data.by_department.shared.total)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, fontWeight: 700 }}>
                          <span style={{ color: "#1E293B" }}>Net profit</span>
                          <span style={{ color: data.profit.net >= 0 ? "#1565C0" : "#B91C1C" }}>{money(data.profit.net)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                          Shared costs have no owner in the books, so they are shown once rather than split by guesswork.
                          {" "}{data.restaurant_orders} restaurant order(s) in this range.
                        </div>
                      </>
                    )}
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
                      [
                        data.revenue.delivery_charges > 0
                          ? `Restaurant revenue (incl. ${money(data.revenue.delivery_charges)} delivery charges)`
                          : "Restaurant revenue",
                        money(data.revenue.restaurant), "#065F46",
                      ],
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
            {/* Product profit */}
            {tab === "products" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "14px 20px" }}>
                  <div style={{ fontSize: 12, color: "#64748B" }}>
                    Sales <strong>{money(prodReport?.totals?.sales ?? 0)}</strong> ·
                    Cost <strong style={{ color: "#B91C1C" }}> {money(prodReport?.totals?.cost ?? 0)}</strong> ·
                    Profit <strong style={{ color: "#059669" }}> {money(prodReport?.totals?.profit ?? 0)}</strong> ·
                    Margin <strong> {prodReport?.totals?.margin_pct ?? 0}%</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={prodSort} onChange={e => setProdSort(e.target.value)} style={{ ...input, width: 170 }}>
                      <option value="sales">Biggest sales</option>
                      <option value="profit">Biggest profit</option>
                      <option value="margin">Lowest margin first</option>
                      <option value="units">Most units sold</option>
                      <option value="name">Name A–Z</option>
                    </select>
                    <button onClick={exportProductsCsv} disabled={!prodReport?.products?.length} style={btn("ghost")}>Export</button>
                  </div>
                </div>
                {prodReport?.totals?.products_without_cost > 0 && (
                  <div style={{ margin: "0 20px 12px", padding: "10px 14px", background: "#FEF3C7", color: "#92400E", borderRadius: 8, fontSize: 12 }}>
                    {prodReport.totals.products_without_cost} product(s) have no cost price set, so their profit shows
                    as if they cost nothing. Add a cost price on the product to correct it.
                  </div>
                )}
                {!prodReport?.products?.length ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>No product sales in this range.</div>
                ) : (
                  <div style={{ maxHeight: 460, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#F8FAFC", position: "sticky", top: 0 }}>
                        {["Product", "Units", "Sales", "Cost", "Profit", "Margin"].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {sortedProducts.map(p => (
                          <tr key={p.key} style={{ borderTop: "1px solid #F1F5F9" }}>
                            <td style={{ ...td, color: "#1E293B" }}>
                              {p.name}
                              {p.category && <span style={{ color: "#94A3B8", fontSize: 11 }}> · {p.category}</span>}
                              {p.no_cost_set && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "1px 6px", borderRadius: 8 }}>no cost</span>}
                            </td>
                            <td style={td}>{p.units}</td>
                            <td style={td}>{money(p.sales)}</td>
                            <td style={{ ...td, color: "#B91C1C" }}>{money(p.cost)}</td>
                            <td style={{ ...td, fontWeight: 700, color: p.profit >= 0 ? "#059669" : "#B91C1C" }}>{money(p.profit)}</td>
                            <td style={td}>{p.margin_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ padding: "10px 20px 16px", fontSize: 11, color: "#94A3B8" }}>
                  Sales are the dish prices before any bill-level discount, service charge, tax or delivery charge.
                  Cost is what the dish cost when it was sold.
                </div>
              </div>
            )}

            {/* Who we owe */}
            {tab === "owed" && (
              <div style={{ padding: "16px 20px 20px" }}>
                <div style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
                  As of today. Suppliers <strong style={{ color: "#B91C1C" }}>{money(payables?.totals?.suppliers ?? 0)}</strong> ·
                  Agent commission <strong style={{ color: "#B91C1C" }}> {money(payables?.totals?.commissions ?? 0)}</strong> ·
                  Total we owe <strong style={{ color: "#B91C1C" }}> {money(payables?.totals?.total ?? 0)}</strong>
                </div>
                {!payables?.suppliers?.length && !payables?.commissions?.length ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nothing is owed right now.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ background: "#F8FAFC" }}>
                      {["Owed to", "Details", "Oldest unpaid", "Amount owed"].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {payables.suppliers.map(s => (
                        <tr key={`s${s.sup_id}`} style={{ borderTop: "1px solid #F1F5F9", verticalAlign: "top" }}>
                          <td style={{ ...td, color: "#1E293B", fontWeight: 600 }}>
                            {s.supplier}
                            {s.contact && <div style={{ fontWeight: 400, fontSize: 11, color: "#94A3B8" }}>{s.contact}</div>}
                          </td>
                          <td style={td}>
                            {s.orders.map(o => (
                              <div key={o.po_id} style={{ fontSize: 12 }}>
                                PO#{o.po_id} · {money(o.balance)} still owed of {money(o.total)}
                                {o.days_outstanding != null && <span style={{ color: o.days_outstanding > 30 ? "#B91C1C" : "#94A3B8" }}> · {o.days_outstanding} day(s)</span>}
                              </div>
                            ))}
                          </td>
                          <td style={td}>{s.oldest_unpaid ? dmy(s.oldest_unpaid) : "—"}</td>
                          <td style={{ ...td, fontWeight: 700, color: "#B91C1C" }}>{money(s.owed)}</td>
                        </tr>
                      ))}
                      {payables.commissions.map(c => (
                        <tr key={`c${c.agent_id}`} style={{ borderTop: "1px solid #F1F5F9" }}>
                          <td style={{ ...td, color: "#1E293B", fontWeight: 600 }}>{c.agent}<div style={{ fontWeight: 400, fontSize: 11, color: "#94A3B8" }}>Agent commission</div></td>
                          <td style={td}>{c.records} unpaid record(s)</td>
                          <td style={td}>{c.oldest ? dmy(c.oldest) : "—"}</td>
                          <td style={{ ...td, fontWeight: 700, color: "#B91C1C" }}>{money(c.owed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ marginTop: 12, fontSize: 11, color: "#94A3B8" }}>
                  A supplier is owed only for goods that have been received and not fully paid for.
                </div>
              </div>
            )}

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
                              {t.delivery_charge > 0 && (
                                <div style={{ fontWeight: 400, fontSize: 11, color: "#64748B" }}>
                                  incl. {money(t.delivery_charge)} delivery
                                </div>
                              )}
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
