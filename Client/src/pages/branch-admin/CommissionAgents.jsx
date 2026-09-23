import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import { useAuth } from "../../context/AuthContext";
import { dayKey, monthKey, todayKey } from "../../utils/dates";
import {
  getAgents, createAgent, updateAgent, deleteAgent,
  getCommissionRecords, createCommissionRecord, updateCommissionRecord, deleteCommissionRecord,
} from "../../services/api";
import { exportCsv, dateCell } from "../../utils/exportCsv";

function initials(name) {
  return (name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
}
function fmt2(v) { return Number(v||0).toLocaleString("en-LK", { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function thisMonth() { return monthKey(new Date()); }

const BLANK_AGENT = { agent_name:"", agent_phone:"", agent_email:"", commission_rate:"", notes:"" };
const blankRecord = () => ({ commission_amount:"", record_date: todayKey(), notes:"", status:"pending", order_id:"" });

const COLORS = ["#1565C0","#0F766E","#7C3AED","#BE185D","#D97706","#0369A1","#166534","#9333EA"];
function agentColor(id) { return COLORS[id % COLORS.length]; }

export default function CommissionAgents() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [agents, setAgents] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  // Agent modal
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [agentForm, setAgentForm] = useState(BLANK_AGENT);
  const [editingAgent, setEditingAgent] = useState(null);

  // Record modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordForm, setRecordForm] = useState(blankRecord);
  const [editingRecord, setEditingRecord] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [ag, rc] = await Promise.all([
        getAgents({ b_id: branchId }),
        getCommissionRecords({ b_id: branchId }),
      ]);
      setAgents(Array.isArray(ag) ? ag : []);
      setRecords(Array.isArray(rc) ? rc : []);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, [branchId]);

  useEffect(() => {
    if (selectedAgent) {
      setSelectedAgent(a => agents.find(ag => ag.agent_id === a?.agent_id) ?? null);
    }
  }, [agents]);

  const agentRecords = useMemo(() => {
    if (!selectedAgent) return [];
    return records.filter(r => r.agent_id === selectedAgent.agent_id).sort((a,b) => dayKey(b.record_date).localeCompare(dayKey(a.record_date)));
  }, [records, selectedAgent]);

  const monthlyBreakdown = useMemo(() => {
    const map = {};
    agentRecords.forEach(r => {
      const m = monthKey(r.record_date);
      if (!map[m]) map[m] = { month:m, total:0, paid:0, pending:0, count:0 };
      map[m].total += Number(r.commission_amount);
      map[m][r.status] = (map[m][r.status]||0) + Number(r.commission_amount);
      map[m].count++;
    });
    return Object.values(map).sort((a,b) => b.month.localeCompare(a.month)).slice(0,6);
  }, [agentRecords]);

  const currentMonthTotal = useMemo(() => {
    const m = thisMonth();
    return agentRecords.filter(r => monthKey(r.record_date) === m).reduce((s,r) => s + Number(r.commission_amount), 0);
  }, [agentRecords]);

  // Agent CRUD
  const openNewAgent = () => { setAgentForm(BLANK_AGENT); setEditingAgent(null); setError(""); setShowAgentModal(true); };
  const openEditAgent = (a) => { setAgentForm({ agent_name:a.agent_name, agent_phone:a.agent_phone||"", agent_email:a.agent_email||"", commission_rate:a.commission_rate, notes:a.notes||"" }); setEditingAgent(a); setError(""); setShowAgentModal(true); };

  const handleAgentSubmit = async (e) => {
    e.preventDefault(); setError("");
    if (String(agentForm.commission_rate).trim() === "" || !(Number(agentForm.commission_rate) >= 0) || Number(agentForm.commission_rate) > 100) {
      setError("Enter the commission rate, between 0 and 100."); return;
    }
    setSubmitting(true);
    try {
      const payload = { ...agentForm, b_id: branchId, commission_rate: Number(agentForm.commission_rate) };
      if (editingAgent) await updateAgent(editingAgent.agent_id, payload);
      else await createAgent(payload);
      setShowAgentModal(false);
      await loadAll();
    } catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteAgent = async (id) => {
    if (!confirm("Delete this agent and all their commission records?")) return;
    try { await deleteAgent(id); if (selectedAgent?.agent_id === id) setSelectedAgent(null); await loadAll(); }
    catch (err) { alert(err?.response?.data?.message || "Could not delete agent"); }
  };

  // Record CRUD
  const openNewRecord = () => { setRecordForm(blankRecord()); setEditingRecord(null); setError(""); setShowRecordModal(true); };
  const openEditRecord = (r) => { setRecordForm({ commission_amount:r.commission_amount, record_date:dayKey(r.record_date), notes:r.notes||"", status:r.status, order_id:r.order_id||"" }); setEditingRecord(r); setError(""); setShowRecordModal(true); };

  const handleRecordSubmit = async (e) => {
    e.preventDefault(); setError("");
    if (!(Number(recordForm.commission_amount) > 0)) { setError("Enter the commission amount."); return; }
    setSubmitting(true);
    try {
      const payload = { ...recordForm, agent_id: selectedAgent.agent_id, commission_amount: Number(recordForm.commission_amount), order_id: recordForm.order_id ? Number(recordForm.order_id) : null };
      if (editingRecord) await updateCommissionRecord(editingRecord.record_id, payload);
      else await createCommissionRecord(payload);
      setShowRecordModal(false);
      await loadAll();
    } catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteRecord = async (id) => {
    if (!confirm("Delete this commission record?")) return;
    try { await deleteCommissionRecord(id); await loadAll(); }
    catch { alert("Could not delete record"); }
  };

  const handleExportRecords = () => {
    if (!agentRecords.length || !selectedAgent) return;
    const head = ["Date", "Amount (LKR)", "Status", "Booking Ref", "Guest", "Order #", "Notes"];
    const rows = agentRecords.map(r => [
      dateCell(dayKey(r.record_date)), r.commission_amount, r.status,
      r.booking_ref || "", r.guest_name || "", r.order_id ?? "", r.notes || "",
    ]);
    exportCsv(`commissions_${selectedAgent.agent_name.replace(/\s+/g, "-")}_${dayKey(new Date())}`, head, rows);
  };

  const statusBadge = (s) => ({
    pending: { bg:"#FEF9C3", color:"#92400E", label:"Pending" },
    paid:    { bg:"#D1FAE5", color:"#065F46", label:"Paid" },
  }[s] || { bg:"#F1F5F9", color:"#475569", label:s });

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:"#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex:1, marginLeft: "var(--sidebar-w, 240px)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <Header title="Commission Agents" />
        <main style={{ flex:1, display:"flex", overflow:"hidden" }}>

          {/* Left: Agent List */}
          <div style={{ width:300, borderRight:"1px solid #E2E8F0", background:"#fff", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ padding:"16px", borderBottom:"1px solid #F1F5F9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:700, fontSize:15, color:"#1E293B" }}>Agents ({agents.length})</span>
              <button onClick={openNewAgent}
                style={{ padding:"6px 14px", background:"#1565C0", color:"#fff", border:"none", borderRadius:8, fontWeight:600, cursor:"pointer", fontSize:13 }}>+ Add</button>
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              {loading ? (
                <div style={{ padding:24, textAlign:"center", color:"#94A3B8" }}>Loading...</div>
              ) : agents.length === 0 ? (
                <div style={{ padding:24, textAlign:"center", color:"#94A3B8", fontSize:13 }}>No agents yet.<br/>Add your first agent.</div>
              ) : agents.map(a => {
                const isSel = selectedAgent?.agent_id === a.agent_id;
                const color = agentColor(a.agent_id);
                return (
                  <div key={a.agent_id} onClick={() => setSelectedAgent(a)}
                    style={{ padding:"14px 16px", borderBottom:"1px solid #F8FAFC", cursor:"pointer", background: isSel?"#EFF6FF":"#fff", display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:color, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:15, flexShrink:0 }}>
                      {initials(a.agent_name)}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:14, color:"#1E293B", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.agent_name}</div>
                      <div style={{ fontSize:12, color:"#64748B" }}>{a.commission_rate}% commission</div>
                      <div style={{ fontSize:12, color:"#94A3B8" }}>
                        Pending: LKR {fmt2(a.pending_total)} · Paid: LKR {fmt2(a.paid_total)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Agent Detail */}
          <div style={{ flex:1, overflowY:"auto", padding:24 }}>
            {!selectedAgent ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", color:"#94A3B8", gap:12 }}>
                <div style={{ fontSize:48 }}>👤</div>
                <div style={{ fontSize:16 }}>Select an agent to view their profile</div>
              </div>
            ) : (() => {
              const color = agentColor(selectedAgent.agent_id);
              const sb = statusBadge;
              return (
                <>
                  {/* Profile Header */}
                  <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E2E8F0", padding:24, marginBottom:20, display:"flex", gap:20, alignItems:"flex-start" }}>
                    <div style={{ width:64, height:64, borderRadius:"50%", background:color, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:24, flexShrink:0 }}>
                      {initials(selectedAgent.agent_name)}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div style={{ fontSize:20, fontWeight:700, color:"#1E293B" }}>{selectedAgent.agent_name}</div>
                          {selectedAgent.agent_phone && <div style={{ fontSize:13, color:"#64748B", marginTop:2 }}>📞 {selectedAgent.agent_phone}</div>}
                          {selectedAgent.agent_email && <div style={{ fontSize:13, color:"#64748B" }}>✉️ {selectedAgent.agent_email}</div>}
                          <div style={{ fontSize:13, color:"#1565C0", marginTop:4, fontWeight:600 }}>Commission rate: {selectedAgent.commission_rate}%</div>
                          {selectedAgent.notes && <div style={{ fontSize:12, color:"#94A3B8", marginTop:4, fontStyle:"italic" }}>{selectedAgent.notes}</div>}
                        </div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={() => openEditAgent(selectedAgent)}
                            style={{ padding:"7px 14px", border:"1px solid #E2E8F0", borderRadius:8, background:"#fff", cursor:"pointer", fontSize:13, fontWeight:600, color:"#475569" }}>Edit</button>
                          <button onClick={() => handleDeleteAgent(selectedAgent.agent_id)}
                            style={{ padding:"7px 14px", border:"1px solid #FECACA", borderRadius:8, background:"#FEF2F2", cursor:"pointer", fontSize:13, fontWeight:600, color:"#DC2626" }}>Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stats row */}
                  {[
                    { label:"This Month", value:`LKR ${fmt2(currentMonthTotal)}`, color:"#1565C0", bg:"#EFF6FF" },
                    { label:"Total Paid", value:`LKR ${fmt2(selectedAgent.paid_total)}`, color:"#065F46", bg:"#D1FAE5" },
                    { label:"Pending", value:`LKR ${fmt2(selectedAgent.pending_total)}`, color:"#92400E", bg:"#FEF9C3" },
                    { label:"All-Time", value:`LKR ${fmt2(selectedAgent.all_time_total)}`, color:"#1E293B", bg:"#F1F5F9" },
                  ].map(s => (
                    <div key={s.label} style={{ display:"inline-block", background:s.bg, borderRadius:10, padding:"14px 20px", marginRight:12, marginBottom:16, minWidth:130 }}>
                      <div style={{ fontSize:11, color:"#64748B", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>{s.label}</div>
                      <div style={{ fontSize:20, fontWeight:700, color:s.color, marginTop:4 }}>{s.value}</div>
                    </div>
                  ))}

                  {/* Monthly Breakdown */}
                  {monthlyBreakdown.length > 0 && (
                    <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E2E8F0", padding:20, marginBottom:20 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:"#1E293B", marginBottom:14 }}>Monthly Breakdown</div>
                      <div style={{ display:"flex", gap:10, overflowX:"auto" }}>
                        {monthlyBreakdown.map(m => {
                          const max = Math.max(...monthlyBreakdown.map(x => x.total));
                          const pct = max > 0 ? (m.total / max) * 100 : 0;
                          return (
                            <div key={m.month} style={{ minWidth:90, textAlign:"center" }}>
                              <div style={{ height:80, display:"flex", alignItems:"flex-end", justifyContent:"center", marginBottom:6 }}>
                                <div style={{ width:48, background:`linear-gradient(to top, #1565C0, #60A5FA)`, borderRadius:"6px 6px 0 0", height:`${pct}%`, minHeight:4 }} title={`LKR ${fmt2(m.total)}`} />
                              </div>
                              <div style={{ fontSize:11, fontWeight:700, color:"#1E293B" }}>{m.month.slice(5)}/{m.month.slice(2,4)}</div>
                              <div style={{ fontSize:10, color:"#64748B" }}>LKR {fmt2(m.total)}</div>
                              <div style={{ fontSize:10, color:"#065F46" }}>Paid: {fmt2(m.paid||0)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Commission Records */}
                  <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E2E8F0", overflow:"hidden" }}>
                    <div style={{ padding:"14px 20px", borderBottom:"1px solid #F1F5F9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontWeight:700, fontSize:14, color:"#1E293B" }}>Commission Records ({agentRecords.length})</span>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={handleExportRecords} disabled={!agentRecords.length}
                          style={{ padding:"7px 16px", background:"#fff", color:"#475569", border:"1px solid #E2E8F0", borderRadius:8, fontWeight:600, cursor: agentRecords.length ? "pointer" : "not-allowed", opacity: agentRecords.length ? 1 : 0.5, fontSize:13 }}>Export CSV</button>
                        <button onClick={openNewRecord}
                          style={{ padding:"7px 16px", background:"#1565C0", color:"#fff", border:"none", borderRadius:8, fontWeight:600, cursor:"pointer", fontSize:13 }}>+ Add Record</button>
                      </div>
                    </div>
                    {agentRecords.length === 0 ? (
                      <div style={{ padding:32, textAlign:"center", color:"#94A3B8" }}>No commission records yet</div>
                    ) : (
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                        <thead>
                          <tr style={{ background:"#F8FAFC" }}>
                            {["Date","Amount","Earned On","Status","Notes",""].map(h => (
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.05em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {agentRecords.map((r, i) => {
                            const b = sb(r.status);
                            return (
                              <tr key={r.record_id} style={{ borderTop:"1px solid #F1F5F9" }}>
                                <td style={{ padding:"12px 16px", color:"#475569" }}>{dayKey(r.record_date)}</td>
                                <td style={{ padding:"12px 16px", fontWeight:700, color:"#1E293B" }}>LKR {fmt2(r.commission_amount)}</td>
                                <td style={{ padding:"12px 16px", color:"#94A3B8" }}>
                                  {r.booking_ref ? (
                                    <span>
                                      <span style={{ color:"#1565C0", fontWeight:600 }}>{r.booking_ref}</span>
                                      {r.guest_name && <span style={{ display:"block", fontSize:11 }}>{r.guest_name}</span>}
                                    </span>
                                  ) : r.order_id ? `Order #${r.order_id}` : "—"}
                                </td>
                                <td style={{ padding:"12px 16px" }}>
                                  <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:b.bg, color:b.color }}>{b.label}</span>
                                </td>
                                <td style={{ padding:"12px 16px", color:"#64748B", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.notes||"—"}</td>
                                <td style={{ padding:"12px 16px" }}>
                                  <div style={{ display:"flex", gap:8 }}>
                                    <button onClick={() => openEditRecord(r)} style={{ padding:"4px 10px", border:"1px solid #E2E8F0", borderRadius:6, background:"#fff", cursor:"pointer", fontSize:12, color:"#475569" }}>Edit</button>
                                    {!r.booking_id && (
                                      <button onClick={() => handleDeleteRecord(r.record_id)} style={{ padding:"4px 10px", border:"1px solid #FECACA", borderRadius:6, background:"#FEF2F2", cursor:"pointer", fontSize:12, color:"#DC2626" }}>Del</button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </main>
      </div>

      {/* Agent Modal */}
      {showAgentModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:440, boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#1E293B" }}>{editingAgent ? "Edit Agent" : "Add Agent"}</h2>
              <button onClick={() => setShowAgentModal(false)} style={{ background:"none", border:"none", fontSize:18, color:"#94A3B8", cursor:"pointer" }}>✕</button>
            </div>
            {error && <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:13 }}>{error}</div>}
            <form onSubmit={handleAgentSubmit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {[
                { key:"agent_name", label:"Full Name *", placeholder:"e.g. Thanuja Weerasekara", type:"text", required:true },
                { key:"agent_phone", label:"Phone Number", placeholder:"+94 77 123 4567", type:"tel" },
                { key:"agent_email", label:"Email", placeholder:"agent@example.com", type:"email" },
                { key:"commission_rate", label:"Commission Rate (%)", placeholder:"10", type:"number" },
              ].map(f => (
                <label key={f.key} style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>{f.label}
                  <input type={f.type} placeholder={f.placeholder} value={agentForm[f.key]}
                    required={f.required || f.key === "commission_rate"}
                    min={f.type === "number" ? 0 : undefined} max={f.type === "number" ? 100 : undefined}
                    step={f.type === "number" ? "0.01" : undefined}
                    onChange={e => setAgentForm(p => ({...p, [f.key]: e.target.value}))}
                    style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
                </label>
              ))}
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Notes (optional)
                <textarea value={agentForm.notes} onChange={e => setAgentForm(p=>({...p,notes:e.target.value}))} rows={2}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
              </label>
              <div style={{ display:"flex", gap:12, marginTop:4 }}>
                <button type="button" onClick={() => setShowAgentModal(false)}
                  style={{ flex:1, padding:11, border:"1px solid #E2E8F0", borderRadius:10, fontWeight:600, color:"#64748B", background:"#fff", cursor:"pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting}
                  style={{ flex:1, padding:11, border:"none", borderRadius:10, fontWeight:700, color:"#fff", background:"#1565C0", cursor:"pointer", opacity:submitting?0.7:1 }}>
                  {submitting ? "Saving..." : editingAgent ? "Update" : "Add Agent"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Modal */}
      {showRecordModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:420, boxShadow:"0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#1E293B" }}>{editingRecord ? "Edit Record" : `Add Commission — ${selectedAgent?.agent_name}`}</h2>
              <button onClick={() => setShowRecordModal(false)} style={{ background:"none", border:"none", fontSize:18, color:"#94A3B8", cursor:"pointer" }}>✕</button>
            </div>
            {error && <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", padding:"10px 14px", borderRadius:8, marginBottom:16, fontSize:13 }}>{error}</div>}
            <form onSubmit={handleRecordSubmit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Commission Amount (LKR) *
                <input type="number" min={0} step="0.01" value={recordForm.commission_amount} onChange={e => setRecordForm(p=>({...p,commission_amount:e.target.value}))} required
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
              </label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Date
                  <input type="date" value={recordForm.record_date} onChange={e => setRecordForm(p=>({...p,record_date:e.target.value}))}
                    style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
                </label>
                <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Status
                  <select value={recordForm.status} onChange={e => setRecordForm(p=>({...p,status:e.target.value}))}
                    style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14 }}>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>
              </div>
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Linked Order # (optional)
                <input type="number" value={recordForm.order_id} onChange={e => setRecordForm(p=>({...p,order_id:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
              </label>
              <label style={{ fontSize:12, fontWeight:600, color:"#64748B" }}>Notes
                <textarea value={recordForm.notes} onChange={e => setRecordForm(p=>({...p,notes:e.target.value}))} rows={2}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"9px 12px", border:"1px solid #E2E8F0", borderRadius:8, fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
              </label>
              <div style={{ display:"flex", gap:12, marginTop:4 }}>
                <button type="button" onClick={() => setShowRecordModal(false)}
                  style={{ flex:1, padding:11, border:"1px solid #E2E8F0", borderRadius:10, fontWeight:600, color:"#64748B", background:"#fff", cursor:"pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting}
                  style={{ flex:1, padding:11, border:"none", borderRadius:10, fontWeight:700, color:"#fff", background:"#1565C0", cursor:"pointer", opacity:submitting?0.7:1 }}>
                  {submitting ? "Saving..." : editingRecord ? "Update" : "Add Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
