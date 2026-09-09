import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import { useAuth } from "../../context/AuthContext";
import { getExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense } from "../../services/api";

const CATEGORIES = [
  { key:"utilities",    label:"Utilities",       icon:"💡" },
  { key:"salary",       label:"Salary",          icon:"👥" },
  { key:"raw_materials",label:"Raw Materials",   icon:"🥦" },
  { key:"commission",   label:"Commission",      icon:"🤝" },
  { key:"maintenance",  label:"Maintenance",     icon:"🔧" },
  { key:"marketing",    label:"Marketing",       icon:"📢" },
  { key:"delivery",     label:"Delivery",        icon:"🚚" },
  { key:"food_packets", label:"Food Packets",    icon:"📦" },
  { key:"other",        label:"Other",           icon:"📋" },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

function fmt(v) { return Number(v||0).toLocaleString("en-LK", { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function todayStr() { return new Date().toISOString().slice(0,10); }
function thisYear() { return new Date().getFullYear(); }

const BLANK_EXPENSE = { exp_category:"utilities", exp_amount:"", exp_description:"", exp_date: todayStr() };

export default function Accounting() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [tab, setTab] = useState("overview"); // overview | expenses | income
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK_EXPENSE);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [filterCat, setFilterCat] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo]   = useState("");

  const year = thisYear();

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = { b_id: branchId };
      if (filterCat !== "all") params.category = filterCat;
      if (filterFrom) params.from = filterFrom;
      if (filterTo)   params.to   = filterTo;
      const [exp, sum] = await Promise.all([
        getExpenses(params),
        getExpenseSummary({ b_id: branchId, year }),
      ]);
      setExpenses(Array.isArray(exp) ? exp : []);
      setSummary(sum && typeof sum === "object" ? sum : {});
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [branchId, filterCat, filterFrom, filterTo]);

  const totalExpenses = Number(summary.totalExpenses || 0);
  const totalRevenue  = Number(summary.totalRevenue  || 0);
  const netProfit     = totalRevenue - totalExpenses;
  const commPending   = Number(summary.commissionPending || 0);

  const byCategory = useMemo(() => {
    return (summary.byCategory || []).map(r => ({
      ...r,
      cat: CAT_MAP[r.exp_category] || { label: r.exp_category, icon:"📋" },
      pct: totalExpenses > 0 ? (Number(r.total) / totalExpenses * 100).toFixed(1) : 0,
    }));
  }, [summary, totalExpenses]);

  const monthlyData = useMemo(() => {
    const map = {};
    (summary.monthly || []).forEach(r => {
      if (!map[r.month]) map[r.month] = { month:r.month, total:0 };
      map[r.month].total += Number(r.total);
    });
    return Object.values(map).sort((a,b) => a.month < b.month ? -1 : 1).slice(-6);
  }, [summary]);

  const openNew = () => { setForm(BLANK_EXPENSE); setEditingId(null); setError(""); setShowModal(true); };
  const openEdit = (e) => { setForm({ exp_category:e.exp_category, exp_amount:e.exp_amount, exp_description:e.exp_description||"", exp_date:e.exp_date?.slice(0,10) }); setEditingId(e.exp_id); setError(""); setShowModal(true); };

  const handleSubmit = async (ev) => {
    ev.preventDefault(); setSubmitting(true); setError("");
    try {
      const payload = { ...form, b_id: branchId, exp_amount: Number(form.exp_amount) };
      if (editingId) await updateExpense(editingId, payload);
      else await createExpense(payload);
      setShowModal(false);
      await load();
    } catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this expense?")) return;
    try { await deleteExpense(id); await load(); }
    catch { alert("Could not delete expense"); }
  };

  const TAB_STYLE = (t) => ({
    padding:"10px 20px", border:"none", borderBottom: tab===t ? "2px solid #1565C0" : "2px solid transparent",
    background:"none", cursor:"pointer", fontWeight: tab===t ? 700 : 400, color: tab===t ? "#1565C0" : "#64748B", fontSize:14
  });

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:"#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex:1, marginLeft: "var(--sidebar-w, 240px)", display:"flex", flexDirection:"column" }}>
        <Header title="Accounting & Expenses" />
        <main style={{ flex:1, padding:"24px", overflowY:"auto" }}>

          {/* Stats Row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
            {[
              { label:`Revenue (${year})`,  value:`LKR ${fmt(totalRevenue)}`,  color:"#065F46", bg:"#D1FAE5", border:"#A7F3D0" },
              { label:`Expenses (${year})`, value:`LKR ${fmt(totalExpenses)}`, color:"#9A3412", bg:"#FEF2F2", border:"#FECACA" },
              { label:"Net Profit",         value:`LKR ${fmt(netProfit)}`,     color: netProfit>=0?"#1565C0":"#DC2626", bg:"#EFF6FF", border:"#BFDBFE" },
              { label:"Commission Pending", value:`LKR ${fmt(commPending)}`,   color:"#92400E", bg:"#FEF9C3", border:"#FDE68A" },
            ].map(s => (
              <div key={s.label} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:12, padding:"16px 20px" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#64748B", textTransform:"uppercase", letterSpacing:1 }}>{s.label}</div>
                <div style={{ fontSize:22, fontWeight:700, color:s.color, margin:"6px 0 0" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ background:"#fff", borderRadius:"12px 12px 0 0", border:"1px solid #E2E8F0", borderBottom:"none" }}>
            <div style={{ display:"flex", borderBottom:"1px solid #E2E8F0", paddingLeft:8 }}>
              {[["overview","Overview"],["expenses","Expenses"],["income","Income"]].map(([k,l]) => (
                <button key={k} onClick={() => setTab(k)} style={TAB_STYLE(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div style={{ background:"#fff", border:"1px solid #E2E8F0", borderTop:"none", borderRadius:"0 0 12px 12px", padding:24 }}>

            {/* OVERVIEW TAB */}
            {tab === "overview" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>

                {/* Expenses by Category */}
                <div>
                  <div style={{ fontWeight:700, fontSize:15, color:"#1E293B", marginBottom:16 }}>Expenses by Category ({year})</div>
                  {byCategory.length === 0 ? (
                    <div style={{ color:"#94A3B8", padding:20, textAlign:"center" }}>No expense data</div>
                  ) : byCategory.map(c => (
                    <div key={c.exp_category} style={{ marginBottom:12 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                        <span>{c.cat.icon} {c.cat.label}</span>
                        <span style={{ fontWeight:700, color:"#1E293B" }}>LKR {fmt(c.total)} <span style={{ fontSize:11, color:"#94A3B8" }}>({c.pct}%)</span></span>
                      </div>
                      <div style={{ background:"#F1F5F9", borderRadius:4, overflow:"hidden", height:8 }}>
                        <div style={{ width:`${c.pct}%`, height:"100%", background:"#1565C0", borderRadius:4 }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Monthly Trend */}
                <div>
                  <div style={{ fontWeight:700, fontSize:15, color:"#1E293B", marginBottom:16 }}>Monthly Expense Trend</div>
                  {monthlyData.length === 0 ? (
                    <div style={{ color:"#94A3B8", padding:20, textAlign:"center" }}>No monthly data</div>
                  ) : (
                    <div style={{ display:"flex", gap:12, alignItems:"flex-end", height:140 }}>
                      {monthlyData.map(m => {
                        const max = Math.max(...monthlyData.map(x=>x.total));
                        const pct = max > 0 ? (m.total/max*100) : 0;
                        return (
                          <div key={m.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                            <div style={{ fontSize:10, fontWeight:700, color:"#64748B" }}>LKR {Math.round(m.total/1000)}k</div>
                            <div style={{ width:"100%", background:`linear-gradient(to top, #EF4444, #F87171)`, borderRadius:"4px 4px 0 0", height:`${pct}%`, minHeight:4 }} />
                            <div style={{ fontSize:10, color:"#94A3B8" }}>{m.month.slice(5)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* P&L Summary */}
                  <div style={{ marginTop:24, background:"#F8FAFC", borderRadius:10, padding:16 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:"#1E293B", marginBottom:12 }}>P&amp;L Summary ({year})</div>
                    {[
                      ["Total Revenue", fmt(totalRevenue), "#065F46"],
                      ["Total Expenses", `(${fmt(totalExpenses)})`, "#DC2626"],
                      ["Commission Pending", `(${fmt(commPending)})`, "#92400E"],
                      ["Net Profit", fmt(netProfit), netProfit>=0?"#1565C0":"#DC2626"],
                    ].map(([k,v,c], i, arr) => (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom: i<arr.length-1?"1px solid #E2E8F0":"2px solid #CBD5E1", fontWeight: i===arr.length-1?700:400, color:"#1E293B", fontSize:13 }}>
                        <span>{k}</span><span style={{ color:c, fontWeight:700 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* EXPENSES TAB */}
            {tab === "expenses" && (
              <>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:20 }}>
                  <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
                    style={{ padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:9, fontSize:13, background:"#fff" }}>
                    <option value="all">All Categories</option>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                  </select>
                  <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                    style={{ padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:9, fontSize:13 }} />
                  <span style={{ color:"#94A3B8" }}>to</span>
                  <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                    style={{ padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:9, fontSize:13 }} />
                  <button onClick={() => { setFilterCat("all"); setFilterFrom(""); setFilterTo(""); }}
                    style={{ padding:"9px 14px", border:"1px solid #E2E8F0", borderRadius:9, background:"#fff", cursor:"pointer", fontSize:13, color:"#64748B" }}>Clear</button>
                  <div style={{ flex:1 }} />
                  <button onClick={openNew}
                    style={{ padding:"9px 18px", background:"#1565C0", color:"#fff", border:"none", borderRadius:9, fontWeight:700, cursor:"pointer", fontSize:13 }}>+ Add Expense</button>
                </div>

                {loading ? (
                  <div style={{ textAlign:"center", padding:"48px 0", color:"#94A3B8" }}>Loading...</div>
                ) : expenses.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"48px 0", color:"#94A3B8" }}>No expenses found.</div>
                ) : (
                  <div style={{ border:"1px solid #E2E8F0", borderRadius:10, overflow:"hidden" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ background:"#F8FAFC" }}>
                          {["Date","Category","Amount","Description","Added By",""].map(h => (
                            <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.05em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((e, i) => {
                          const cat = CAT_MAP[e.exp_category] || { icon:"📋", label: e.exp_category };
                          return (
                            <tr key={e.exp_id} style={{ borderTop:"1px solid #F1F5F9" }}>
                              <td style={{ padding:"12px 16px", color:"#475569" }}>{e.exp_date?.slice(0,10)}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <span style={{ background:"#F1F5F9", padding:"3px 10px", borderRadius:20, fontSize:12 }}>{cat.icon} {cat.label}</span>
                              </td>
                              <td style={{ padding:"12px 16px", fontWeight:700, color:"#DC2626" }}>LKR {fmt(e.exp_amount)}</td>
                              <td style={{ padding:"12px 16px", color:"#64748B", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.exp_description||"—"}</td>
                              <td style={{ padding:"12px 16px", color:"#94A3B8" }}>{e.created_by_name||"—"}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <div style={{ display:"flex", gap:8 }}>
                                  <button onClick={() => openEdit(e)} style={{ padding:"4px 10px", border:"1px solid #E2E8F0", borderRadius:6, background:"#fff", cursor:"pointer", fontSize:12, color:"#475569" }}>Edit</button>
                                  <button onClick={() => handleDelete(e.exp_id)} style={{ padding:"4px 10px", border:"1px solid #FECACA", borderRadius:6, background:"#FEF2F2", cursor:"pointer", fontSize:12, color:"#DC2626" }}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:"#F8FAFC", borderTop:"2px solid #E2E8F0" }}>
                          <td colSpan={2} style={{ padding:"12px 16px", fontWeight:700, color:"#1E293B" }}>Total</td>
                          <td style={{ padding:"12px 16px", fontWeight:700, color:"#DC2626" }}>
                            LKR {fmt(expenses.reduce((s,e) => s + Number(e.exp_amount), 0))}
                          </td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* INCOME TAB */}
            {tab === "income" && (
              <div>
                <div style={{ background:"#D1FAE5", border:"1px solid #A7F3D0", borderRadius:10, padding:"16px 20px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:"#064E3B", textTransform:"uppercase" }}>Total Revenue ({year})</div>
                    <div style={{ fontSize:28, fontWeight:700, color:"#065F46", marginTop:4 }}>LKR {fmt(totalRevenue)}</div>
                  </div>
                  <div style={{ fontSize:32 }}>📈</div>
                </div>
                <div style={{ background:"#FEF9C3", border:"1px solid #FDE68A", borderRadius:10, padding:"14px 20px", marginBottom:20, fontSize:13, color:"#92400E" }}>
                  Income is pulled automatically from completed/paid orders. Use the <strong>Expenses</strong> tab to track outgoings.
                </div>
                {monthlyData.length > 0 && (
                  <div style={{ border:"1px solid #E2E8F0", borderRadius:10, overflow:"hidden" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                      <thead>
                        <tr style={{ background:"#F8FAFC" }}>
                          {["Month","Expense","Revenue (auto)","Net"].map(h => (
                            <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(summary.monthly ? [...new Set((summary.monthly||[]).map(r=>r.month))].sort().reverse().slice(0,12).map(m => {
                          const expTotal = (summary.monthly||[]).filter(r=>r.month===m).reduce((s,r)=>s+Number(r.total),0);
                          return { month:m, exp:expTotal };
                        }) : []).map(row => (
                          <tr key={row.month} style={{ borderTop:"1px solid #F1F5F9" }}>
                            <td style={{ padding:"12px 16px", fontWeight:600, color:"#1E293B" }}>{row.month}</td>
                            <td style={{ padding:"12px 16px", color:"#DC2626" }}>LKR {fmt(row.exp)}</td>
                            <td style={{ padding:"12px 16px", color:"#065F46" }}>—</td>
                            <td style={{ padding:"12px 16px", color:"#1565C0", fontWeight:600 }}>—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Expense Modal */}
      {showModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:440, boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#1E293B" }}>{editingId ? "Edit Expense" : "Add Expense"}</h2>
              <button onClick={() => setShowModal(false)} style={{ background:"none", border:"none", fontSize:18, color:"#94A3B8", cursor:"pointer" }}>✕</button>
            </div>
            {error && <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:13 }}>{error}</div>}
            <form onSubmit={handleSubmit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Category *
                <select value={form.exp_category} onChange={e => setForm(p=>({...p,exp_category:e.target.value}))} required
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14 }}>
                  {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                </select>
              </label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Amount (LKR) *
                  <input type="number" min={0.01} step="0.01" value={form.exp_amount} onChange={e => setForm(p=>({...p,exp_amount:e.target.value}))} required
                    style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
                </label>
                <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Date *
                  <input type="date" value={form.exp_date} onChange={e => setForm(p=>({...p,exp_date:e.target.value}))} required
                    style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
                </label>
              </div>
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Description
                <textarea value={form.exp_description} onChange={e => setForm(p=>({...p,exp_description:e.target.value}))} rows={2}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
              </label>
              <div style={{ display:"flex", gap:12, marginTop:4 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex:1, padding:11, border:"1px solid #E2E8F0", borderRadius:10, fontWeight:600, color:"#64748B", background:"#fff", cursor:"pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting}
                  style={{ flex:1, padding:11, border:"none", borderRadius:10, fontWeight:700, color:"#fff", background:"#1565C0", cursor:"pointer", opacity:submitting?0.7:1 }}>
                  {submitting ? "Saving..." : editingId ? "Update" : "Add Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
