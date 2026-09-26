import React from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const money = (v) => `LKR ${Number(v || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const prettyMonth = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};
const prettyDay = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const RANGES = [
  [3, "3M"],
  [6, "6M"],
  [12, "12M"],
];

/** Same AreaChart shape as components/admin/SalesChart.jsx, generalized with
 * a title/subtitle so it can be reused for both the overall and per-supplier
 * spend trend. The time-range control is controlled by the parent (months +
 * onMonthsChange) since the parent owns the actual data fetch. */
export default function SpendTrendChart({
  data = [], title = "Purchasing Trend", subtitle,
  months = 12, onMonthsChange, granularity = "month",
}) {
  const chartData = granularity === "day"
    ? data.map((d) => ({ ...d, label: prettyDay(d.day) }))
    : data.map((d) => ({ ...d, label: prettyMonth(d.month) }));
  return (
    <div style={{ background: "#fff", padding: "20px 24px", borderRadius: "16px", border: "1px solid #EAECF0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#101828" }}>{title}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#667085" }}>{subtitle || `Monthly spend, last ${months} months`}</p>
        </div>
        {onMonthsChange && (
          <div style={{ display: "flex", gap: "4px", background: "#F2F4F7", borderRadius: "8px", padding: "3px" }}>
            {RANGES.map(([n, label]) => (
              <button
                key={n}
                type="button"
                onClick={() => onMonthsChange(n)}
                style={{
                  padding: "5px 12px", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                  cursor: "pointer", background: months === n ? "#fff" : "transparent",
                  color: months === n ? "#1565C0" : "#667085",
                  boxShadow: months === n ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ left: -20 }}>
          <defs>
            <linearGradient id="spendTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1565C0" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#1565C0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2F4F7" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#98A2B3", fontSize: 11 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#98A2B3", fontSize: 11 }} tickFormatter={(v) => money(v)} width={70} />
          <Tooltip
            formatter={(v) => [money(v), "Spend"]}
            contentStyle={{ borderRadius: "10px", border: "1px solid #EAECF0", fontSize: "12px" }}
          />
          <Area type="monotone" dataKey="total" stroke="#1565C0" strokeWidth={2.5} fillOpacity={1} fill="url(#spendTrendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
