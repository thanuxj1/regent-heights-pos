import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import StatCard from "../../components/branch-admin/StatCard";
import { useAuth } from "../../context/AuthContext";
import {
  getRawMaterials,
  getWaste,
  getWastePercentage,
  createWaste,
  updateWaste,
  deleteWaste,
} from "../../services/api";
import { dayKey, todayKey } from "../../utils/dates";
import { exportCsv, dateCell } from "../../utils/exportCsv";

const ROLES = { SUPER_ADMIN: 6 };

function fmtQty(n) {
  return Number(Number(n).toFixed(3)).toString();
}

function money(n) {
  return `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const blankForm = () => ({ rm_id: "", waste_qty: "", reason: "" });

export default function WasteTracking() {
  const { user } = useAuth();
  // Editing/deleting a record is Admin-only on the backend (a retired role
  // nobody holds today) or Super Admin, which bypasses every role check.
  // Showing the controls to anyone else would just 403 on click.
  const canEditDelete = Number(user?.role_id) === ROLES.SUPER_ADMIN;

  const [materials, setMaterials] = useState([]);
  const [waste, setWaste] = useState([]);
  const [percentages, setPercentages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [mats, wasteRows, pct] = await Promise.allSettled([
        getRawMaterials(),
        getWaste(),
        getWastePercentage(),
      ]);
      if (mats.status === "fulfilled") {
        const list = Array.isArray(mats.value) ? mats.value : mats.value?.data || [];
        setMaterials(list);
      }
      if (wasteRows.status === "fulfilled") setWaste(Array.isArray(wasteRows.value) ? wasteRows.value : []);
      if (pct.status === "fulfilled") setPercentages(Array.isArray(pct.value) ? pct.value : []);
      const failed = [mats, wasteRows, pct].find((r) => r.status === "rejected");
      setLoadError(failed ? (failed.reason?.response?.data?.message || "Some data could not be loaded — try again.") : "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredWaste = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return waste;
    return waste.filter((w) => (w.rm_name || "").toLowerCase().includes(q) || (w.reason || "").toLowerCase().includes(q));
  }, [waste, searchTerm]);

  const topWasted = percentages.slice(0, 1)[0];
  const totalWasteValue = useMemo(() => waste.reduce((s, w) => s + Number(w.waste_value || 0), 0), [waste]);

  const openNew = () => { setForm(blankForm()); setEditingId(null); setError(""); setShowModal(true); };
  const openEdit = (w) => { setForm({ rm_id: w.rm_id, waste_qty: w.waste_qty, reason: w.reason || "" }); setEditingId(w.waste_id); setError(""); setShowModal(true); };

  const handleExport = () => {
    if (!filteredWaste.length) return;
    const head = ["Date", "Item", "Quantity", "Value (LKR)", "Reason"];
    const rows = filteredWaste.map((w) => [dateCell(dayKey(w.recorded_at)), w.rm_name, fmtQty(w.waste_qty), Number(w.waste_value || 0).toFixed(2), w.reason || ""]);
    exportCsv(`waste_${todayKey()}`, head, rows);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError("");
    if (!form.rm_id) { setError("Choose which item was wasted."); return; }
    if (!(Number(form.waste_qty) > 0)) { setError("Enter the quantity wasted."); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        await updateWaste(editingId, { waste_qty: Number(form.waste_qty), reason: form.reason?.trim() || undefined });
      } else {
        await createWaste({ rm_id: Number(form.rm_id), waste_qty: Number(form.waste_qty), reason: form.reason?.trim() || undefined });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this waste record? The wasted quantity will be restored to stock.")) return;
    try { await deleteWaste(id); await load(); }
    catch (err) { alert(err?.response?.data?.message || "Could not delete waste record."); }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Waste Tracking" />
        <main style={{ flex: 1, padding: "24px", overflowY: "auto" }}>

          {loadError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              {loadError}
            </div>
          )}

          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title="Waste Records" value={waste.length} icon="🗑️" iconClass="bg-slate-100 text-slate-600" showAction={false} onClick={() => {}} />
            <StatCard title="Total Waste Value" value={money(totalWasteValue)} subtitle="Cost of everything wasted" icon="💸" iconClass="bg-rose-100 text-rose-700" showAction={false} onClick={() => {}} />
            <StatCard
              title="Highest Waste %"
              value={topWasted ? `${topWasted.rm_name}` : "—"}
              subtitle={topWasted ? `${topWasted.waste_percentage}% of ${topWasted.rm_name}` : "No waste recorded yet"}
              icon="⚠️"
              iconClass="bg-amber-100 text-amber-700"
              showAction={false}
              onClick={() => {}}
            />
            <StatCard
              title="Items Tracked"
              value={percentages.length}
              subtitle="Raw materials with recorded waste history"
              icon="📦"
              iconClass="bg-blue-100 text-blue-700"
              showAction={false}
              onClick={() => {}}
            />
          </div>

          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
              <input
                type="text"
                placeholder="Search by item or reason..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 13, minWidth: 220 }}
              />
              <div style={{ flex: 1 }} />
              <button onClick={handleExport} disabled={!filteredWaste.length}
                style={{ padding: "9px 14px", border: "1px solid #E2E8F0", borderRadius: 9, background: "#fff", cursor: filteredWaste.length ? "pointer" : "not-allowed", opacity: filteredWaste.length ? 1 : 0.5, fontSize: 13, color: "#475569", fontWeight: 600 }}>
                Export CSV
              </button>
              <button onClick={openNew}
                style={{ padding: "9px 18px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                + Record Waste
              </button>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>Loading...</div>
            ) : filteredWaste.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>No waste records found.</div>
            ) : (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC" }}>
                      {["Date", "Item", "Quantity", "Value", "Reason", ""].map((h) => (
                        <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWaste.map((w) => (
                      <tr key={w.waste_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 16px", color: "#475569" }}>{dayKey(w.recorded_at)}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1E293B" }}>{w.rm_name}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 700, color: "#DC2626" }}>{fmtQty(w.waste_qty)}</td>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1E293B" }}>{money(w.waste_value)}</td>
                        <td style={{ padding: "12px 16px", color: "#64748B", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.reason || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          {canEditDelete && (
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => openEdit(w)} style={{ padding: "4px 10px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" }}>Edit</button>
                              <button onClick={() => handleDelete(w.waste_id)} style={{ padding: "4px 10px", border: "1px solid #FECACA", borderRadius: 6, background: "#FEF2F2", cursor: "pointer", fontSize: 12, color: "#DC2626" }}>Delete</button>
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

          {/* Waste % breakdown */}
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24, marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 16 }}>Waste % by Item</div>
            {percentages.length === 0 ? (
              <div style={{ color: "#94A3B8", padding: 20, textAlign: "center" }}>No waste data</div>
            ) : (
              percentages.map((p) => (
                <div key={p.rm_id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{p.rm_name}</span>
                    <span style={{ fontWeight: 700, color: "#1E293B" }}>
                      {p.waste_percentage}% <span style={{ fontSize: 11, color: "#94A3B8" }}>({p.total_wasted} of {Number(p.current_stock) + Number(p.total_wasted)} {p.unit})</span>
                    </span>
                  </div>
                  <div style={{ background: "#F1F5F9", borderRadius: 4, overflow: "hidden", height: 8 }}>
                    <div style={{ width: `${Math.min(100, Number(p.waste_percentage))}%`, height: "100%", background: "#DC2626", borderRadius: 4 }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>

      {/* Waste Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>{editingId ? "Edit Waste Record" : "Record Waste"}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 18, color: "#94A3B8", cursor: "pointer" }}>✕</button>
            </div>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Item *
                <select value={form.rm_id} onChange={(e) => setForm((p) => ({ ...p, rm_id: e.target.value }))} required disabled={!!editingId}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14 }}>
                  <option value="">Select an item…</option>
                  {materials.map((m) => (
                    <option key={m.rm_id} value={m.rm_id}>{m.rm_name} ({Number(m.stock_qty).toFixed(2)} {m.unit} in stock)</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Quantity Wasted *
                <input type="number" min={0.001} step="0.001" value={form.waste_qty} onChange={(e) => setForm((p) => ({ ...p, waste_qty: e.target.value }))} required
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Reason
                <textarea value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} rows={2}
                  placeholder="e.g. Spoiled, spilled, over-portioned..."
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
              </label>
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: 11, border: "1px solid #E2E8F0", borderRadius: 10, fontWeight: 600, color: "#64748B", background: "#fff", cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting}
                  style={{ flex: 1, padding: 11, border: "none", borderRadius: 10, fontWeight: 700, color: "#fff", background: "#1565C0", cursor: "pointer", opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? "Saving..." : editingId ? "Update" : "Record Waste"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
