import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import StatCard from "../../components/branch-admin/StatCard";
import SpendTrendChart from "../../components/branch-admin/SpendTrendChart";
import {
  getOutstandingCod, getCodHistory, createCodSettlement,
  getDeliveryPartners, createDeliveryPartner, updateDeliveryPartner, deleteDeliveryPartner,
  getDeliveryPartnerAnalytics,
} from "../../services/api";
import { dayKey, todayKey } from "../../utils/dates";
import { exportCsv, dateCell } from "../../utils/exportCsv";

function money(n) {
  return `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
// Same idea as Supplier Management's avatar palette — a stable hash of the
// name always lands on the same color, without storing one.
const AVATAR_PALETTE = [
  ["#EEF4FF", "#3538CD"], ["#ECFDF3", "#067647"], ["#FEF6EE", "#B93815"],
  ["#FDF2FA", "#C11574"], ["#F0F9FF", "#026AA2"], ["#FEF3F2", "#B42318"],
];
const avatarColors = (name) => {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};

const errorText = (e, fallback) => e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;

// Today / This Week / This Month / Custom — a front desk or manager thinks
// in these terms, not in "how many trailing months." Week and month start
// on the calendar boundary and run through today.
function startOfWeekKey() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return dayKey(d);
}
function startOfMonthKey() {
  const d = new Date();
  d.setDate(1);
  return dayKey(d);
}
const RANGE_PRESETS = [["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["custom", "Custom"]];
function rangeFor(mode, customFrom, customTo) {
  const today = todayKey();
  if (mode === "today") return { from: today, to: today };
  if (mode === "week") return { from: startOfWeekKey(), to: today };
  if (mode === "custom") return { from: customFrom || today, to: customTo || today };
  return { from: startOfMonthKey(), to: today };
}

const primaryBtn = { padding: "9px 18px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13 };
const ghostBtn = { padding: "9px 16px", background: "#fff", color: "#344054", border: "1px solid #D0D5DD", borderRadius: 9, fontWeight: 600, cursor: "pointer", fontSize: 13 };
const field = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #D0D5DD", fontSize: 14, outline: "none", boxSizing: "border-box" };

/** One partner: lifetime numbers, a trend, and the settle-outstanding flow. */
function DeliveryPartnerDetailView({ partner, outstanding, history, onBack, onSettled, onToggleActive, onEdit, onDelete }) {
  const partnerOrders = useMemo(
    () => outstanding.orders.filter((o) => (o.delivery_partner || "other") === partner.key),
    [outstanding, partner.key],
  );
  const partnerHistory = useMemo(
    () => history.filter((s) => s.delivery_partner === partner.key),
    [history, partner.key],
  );

  const [analytics, setAnalytics] = useState(null);
  const [rangeMode, setRangeMode] = useState("month");
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const range = rangeFor(rangeMode, customFrom, customTo);

  const loadAnalytics = () =>
    getDeliveryPartnerAnalytics(partner.key, { from: range.from, to: range.to })
      .then(setAnalytics)
      .catch(() => setAnalytics(null));

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner.key, rangeMode, customFrom, customTo]);

  const [checkedIds, setCheckedIds] = useState(() => new Set(partnerOrders.map((o) => o.or_id)));
  const [amount, setAmount] = useState(() => partnerOrders.reduce((s, o) => s + Number(o.amount || 0), 0).toFixed(2));
  const [method, setMethod] = useState("cash");
  const [settledDate, setSettledDate] = useState(todayKey());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [togglingActive, setTogglingActive] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(partner.name);
  const [editContact, setEditContact] = useState(partner.contact || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const checkedTotal = useMemo(
    () => partnerOrders.filter((o) => checkedIds.has(o.or_id)).reduce((s, o) => s + Number(o.amount || 0), 0),
    [partnerOrders, checkedIds],
  );

  const toggleOrder = (or_id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(or_id)) next.delete(or_id); else next.add(or_id);
      return next;
    });
  };

  const handleSettle = async (ev) => {
    ev.preventDefault();
    setError("");
    if (checkedIds.size === 0) { setError("Select at least one order this settlement covers."); return; }
    if (!(Number(amount) > 0)) { setError("Enter the amount received."); return; }
    setSubmitting(true);
    try {
      await createCodSettlement({
        delivery_partner: partner.key,
        amount: Number(amount),
        method,
        settled_date: settledDate,
        note: note.trim() || undefined,
        order_ids: [...checkedIds],
      });
      await onSettled();
      await loadAnalytics();
      setNote("");
    } catch (err) {
      setError(errorText(err, "That did not go through"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async () => {
    setTogglingActive(true);
    try { await onToggleActive(partner, !partner.active); }
    finally { setTogglingActive(false); }
  };

  const startEdit = () => {
    setEditName(partner.name);
    setEditContact(partner.contact || "");
    setEditError("");
    setEditing(true);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name || name.length < 2) { setEditError("Name must be at least 2 characters"); return; }
    setSavingEdit(true);
    setEditError("");
    try {
      await onEdit(partner, { name, contact: editContact.trim() });
      setEditing(false);
    } catch (err) {
      setEditError(errorText(err, "Could not save changes"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${partner.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(partner);
    } catch (err) {
      setDeleteError(errorText(err, "Could not delete this partner"));
    } finally {
      setDeleting(false);
    }
  };

  const handleExportHistory = () => {
    if (!partnerHistory.length) return;
    const head = ["Date", "Amount (LKR)", "Method", "Orders Covered", "Recorded By", "Note"];
    const rows = partnerHistory.map((s) => [
      dateCell(dayKey(s.settled_date)), Number(s.amount).toFixed(2), s.method, s.order_count, s.recorded_by || "", s.note || "",
    ]);
    exportCsv(`${partner.key}_cod_settlements_${todayKey()}`, head, rows);
  };

  const [bg, fg] = avatarColors(partner.name);

  return (
    <div style={{ animation: "fadeIn 0.2s ease-in" }}>
      <button onClick={onBack} style={{ marginBottom: 16, background: "none", border: "none", color: "#1565C0", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
        ← Back to Directory
      </button>

      <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 16, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 240 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
              {initials(partner.name)}
            </div>
            {editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, maxWidth: 320 }}>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Partner name" style={field} />
                <input value={editContact} onChange={(e) => setEditContact(e.target.value)} placeholder="Contact (optional)" style={field} />
              </div>
            ) : (
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#101828" }}>{partner.name}</h2>
                <div style={{ color: "#667085", fontSize: 13, marginTop: 2 }}>{partner.contact || "No contact on file"}</div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} disabled={savingEdit} style={{ ...ghostBtn, padding: "7px 14px" }}>Cancel</button>
                <button onClick={saveEdit} disabled={savingEdit} style={{ ...primaryBtn, padding: "7px 14px", opacity: savingEdit ? 0.6 : 1 }}>
                  {savingEdit ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button onClick={startEdit} style={{ ...ghostBtn, padding: "7px 14px" }}>Edit</button>
                <button onClick={toggleActive} disabled={togglingActive}
                  style={{ padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                    background: partner.active ? "#ECFDF3" : "#F2F4F7", color: partner.active ? "#067647" : "#667085", opacity: togglingActive ? 0.6 : 1 }}>
                  {partner.active ? "● Active" : "○ Inactive — click to reactivate"}
                </button>
                <button onClick={handleDelete} disabled={deleting}
                  style={{ padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700, border: "1px solid #FECACA", cursor: "pointer",
                    background: "#FEF2F2", color: "#B42318", opacity: deleting ? 0.6 : 1 }}>
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </>
            )}
          </div>
        </div>
        {(editError || deleteError) && (
          <div style={{ marginTop: 12, background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
            {editError || deleteError}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard title="Total Orders" value={analytics?.total_orders ?? "—"} icon="🧾" iconClass="bg-blue-100 text-blue-700" showAction={false} onClick={() => {}} />
        <StatCard title="Lifetime COD" value={analytics ? money(analytics.lifetime_cod) : "—"} icon="💵" iconClass="bg-violet-100 text-violet-700" showAction={false} onClick={() => {}} />
        <StatCard title="Lifetime Settled" value={analytics ? money(analytics.lifetime_settled) : "—"} icon="✅" iconClass="bg-emerald-100 text-emerald-700" showAction={false} onClick={() => {}} />
        <StatCard title="Outstanding Now" value={analytics ? money(analytics.outstanding) : "—"} icon="⏳" iconClass="bg-amber-100 text-amber-700" showAction={false} onClick={() => {}} />
      </div>

      {analytics?.trend && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 4, background: "#F2F4F7", borderRadius: 8, padding: 3 }}>
              {RANGE_PRESETS.map(([m, label]) => (
                <button key={m} type="button" onClick={() => setRangeMode(m)}
                  style={{ padding: "5px 12px", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: rangeMode === m ? "#fff" : "transparent", color: rangeMode === m ? "#1565C0" : "#667085",
                    boxShadow: rangeMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                  {label}
                </button>
              ))}
            </div>
            {rangeMode === "custom" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...field, width: 140, padding: "6px 8px" }} />
                <span style={{ color: "#94A3B8", fontSize: 12 }}>to</span>
                <input type="date" value={customTo} min={customFrom} max={todayKey()} onChange={(e) => setCustomTo(e.target.value)} style={{ ...field, width: 140, padding: "6px 8px" }} />
              </div>
            )}
          </div>
          <SpendTrendChart
            data={analytics.trend}
            title={`COD collected — ${partner.name}`}
            subtitle={`${range.from} to ${range.to}`}
            granularity="day"
          />
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 14 }}>
          Settle Outstanding {partnerOrders.length > 0 && `(${money(partnerOrders.reduce((s, o) => s + Number(o.amount || 0), 0))})`}
        </div>
        {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}
        {partnerOrders.length === 0 ? (
          <div style={{ color: "#94A3B8", padding: "12px 0" }}>Nothing outstanding for {partner.name} right now.</div>
        ) : (
          <form onSubmit={handleSettle}>
            <div style={{ border: "1px solid #E2E8F0", borderRadius: 8, maxHeight: 180, overflowY: "auto", marginBottom: 14 }}>
              {partnerOrders.map((o) => (
                <label key={o.or_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #F1F5F9", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={checkedIds.has(o.or_id)} onChange={() => toggleOrder(o.or_id)} />
                  <span style={{ flex: 1, color: "#475569" }}>Order #{o.or_id} — {dayKey(o.or_date)}</span>
                  <span style={{ fontWeight: 600, color: "#1E293B" }}>{money(o.amount)}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>{checkedIds.size} of {partnerOrders.length} selected — {money(checkedTotal)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Amount (LKR)
                <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ ...field, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Date
                <input type="date" value={settledDate} onChange={(e) => setSettledDate(e.target.value)} required style={{ ...field, marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Via
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...field, marginTop: 4 }}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="online">Online</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" style={{ ...field, marginBottom: 12 }} />
            <button type="submit" disabled={submitting} style={{ ...primaryBtn, width: "100%", padding: 11, opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Saving..." : "Record Settlement"}
            </button>
          </form>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B" }}>Settlement History</div>
          <button onClick={handleExportHistory} disabled={!partnerHistory.length}
            style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, background: "#fff", cursor: partnerHistory.length ? "pointer" : "not-allowed", opacity: partnerHistory.length ? 1 : 0.5, fontSize: 12, color: "#475569", fontWeight: 600 }}>
            Export CSV
          </button>
        </div>
        {partnerHistory.length === 0 ? (
          <div style={{ color: "#94A3B8" }}>No settlements recorded yet for {partner.name}.</div>
        ) : partnerHistory.map((s) => (
          <div key={s.settlement_id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
            <span style={{ color: "#475569" }}>{dayKey(s.settled_date)} · {s.order_count} order{s.order_count === 1 ? "" : "s"} · {s.recorded_by || "—"}</span>
            <span style={{ fontWeight: 700, color: "#059669" }}>{money(s.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DeliveryCod() {
  const [partners, setPartners] = useState([]);
  const [outstanding, setOutstanding] = useState({ orders: [], byPartner: [] });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedPartner, setSelectedPartner] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newPartner, setNewPartner] = useState({ name: "", contact: "" });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [p, out, hist] = await Promise.allSettled([getDeliveryPartners(), getOutstandingCod(), getCodHistory()]);
      if (p.status === "fulfilled") setPartners(Array.isArray(p.value) ? p.value : []);
      if (out.status === "fulfilled") setOutstanding(out.value || { orders: [], byPartner: [] });
      if (hist.status === "fulfilled") setHistory(Array.isArray(hist.value) ? hist.value : []);
      const failed = [p, out, hist].find((r) => r.status === "rejected");
      setLoadError(failed ? errorText(failed.reason, "Some data could not be loaded — try again.") : "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Keep the open profile's data current after a settlement or toggle.
  useEffect(() => {
    if (selectedPartner) {
      const fresh = partners.find((p) => p.key === selectedPartner.key);
      if (fresh) setSelectedPartner(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners]);

  const totalOutstanding = useMemo(() => outstanding.byPartner.reduce((s, p) => s + Number(p.total || 0), 0), [outstanding]);
  const outstandingByKey = useMemo(() => new Map(outstanding.byPartner.map((p) => [p.delivery_partner, p])), [outstanding]);

  const handleCreatePartner = async () => {
    setCreateError("");
    const name = newPartner.name.trim();
    if (!name || name.length < 2) { setCreateError("Name must be at least 2 characters"); return; }
    setIsCreating(true);
    try {
      await createDeliveryPartner({ name, contact: newPartner.contact.trim() || undefined });
      setShowAddModal(false);
      setNewPartner({ name: "", contact: "" });
      await load();
    } catch (err) {
      setCreateError(errorText(err, "Failed to add partner"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (partner, active) => {
    await updateDeliveryPartner(partner.partner_id, { active });
    await load();
  };

  const handleEditPartner = async (partner, { name, contact }) => {
    await updateDeliveryPartner(partner.partner_id, { name, contact });
    await load();
  };

  const handleDeletePartner = async (partner) => {
    await deleteDeliveryPartner(partner.partner_id);
    setSelectedPartner(null);
    await load();
  };

  const handleExportHistory = () => {
    if (!history.length) return;
    const head = ["Date", "Partner", "Amount (LKR)", "Method", "Orders Covered", "Recorded By", "Note"];
    const partnerName = (key) => partners.find((p) => p.key === key)?.name || key;
    const rows = history.map((s) => [
      dateCell(dayKey(s.settled_date)), partnerName(s.delivery_partner), Number(s.amount).toFixed(2),
      s.method, s.order_count, s.recorded_by || "", s.note || "",
    ]);
    exportCsv(`delivery_cod_settlements_${todayKey()}`, head, rows);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Delivery COD" />
        <main style={{ flex: 1, padding: "24px", overflowY: "auto" }}>

          {loadError && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              {loadError}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title="Outstanding COD" value={money(totalOutstanding)} subtitle="Cash partners are holding for us" icon="💰" iconClass="bg-violet-100 text-violet-700" showAction={false} onClick={() => {}} />
            <StatCard title="Partners Owing" value={outstanding.byPartner.length} icon="🏍️" iconClass="bg-amber-100 text-amber-700" showAction={false} onClick={() => {}} />
            <StatCard title="Orders Unsettled" value={outstanding.orders.length} icon="🧾" iconClass="bg-blue-100 text-blue-700" showAction={false} onClick={() => {}} />
          </div>

          {selectedPartner ? (
            <DeliveryPartnerDetailView
              key={selectedPartner.key}
              partner={selectedPartner}
              outstanding={outstanding}
              history={history}
              onBack={() => setSelectedPartner(null)}
              onSettled={load}
              onToggleActive={handleToggleActive}
              onEdit={handleEditPartner}
              onDelete={handleDeletePartner}
            />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 18, color: "#101828" }}>Delivery Partners</div>
                <button onClick={() => setShowAddModal(true)} style={{ ...primaryBtn, padding: "10px 18px" }}>+ Add Partner</button>
              </div>

              {loading ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8" }}>Loading...</div>
              ) : partners.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8" }}>No delivery partners yet. Click "+ Add Partner" to create one.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
                  {partners.map((p) => {
                    const [bg, fg] = avatarColors(p.name);
                    const owed = Number(outstandingByKey.get(p.key)?.total || 0);
                    return (
                      <div key={p.partner_id} onClick={() => setSelectedPartner(p)}
                        style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2E8F0", cursor: "pointer", overflow: "hidden", opacity: p.active ? 1 : 0.55, transition: "transform 0.15s, box-shadow 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 20px rgba(16,24,40,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        <div style={{ padding: "18px 20px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: "50%", background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                            {initials(p.name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#101828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                            <div style={{ fontSize: 12, color: "#667085" }}>{p.active ? (p.contact || "No contact") : "Inactive"}</div>
                          </div>
                        </div>
                        <div style={{ padding: "10px 20px", borderTop: "1px solid #F2F4F7", background: owed > 0 ? "#FFFBFA" : "#F9FFFB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#667085", fontWeight: 600 }}>{owed > 0 ? "Balance owed" : "Status"}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: owed > 0 ? "#B42318" : "#067647" }}>{owed > 0 ? money(owed) : "Settled ✓"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B" }}>Settlement History</div>
                  <button onClick={handleExportHistory} disabled={!history.length}
                    style={{ padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, background: "#fff", cursor: history.length ? "pointer" : "not-allowed", opacity: history.length ? 1 : 0.5, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                    Export CSV
                  </button>
                </div>
                {history.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: "#94A3B8" }}>No settlements recorded yet.</div>
                ) : (
                  <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "#F8FAFC" }}>
                          {["Date", "Partner", "Amount", "Method", "Orders", "Recorded By"].map((h) => (
                            <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((s) => (
                          <tr key={s.settlement_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "12px 16px", color: "#475569" }}>{dayKey(s.settled_date)}</td>
                            <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1E293B" }}>{partners.find((p) => p.key === s.delivery_partner)?.name || s.delivery_partner}</td>
                            <td style={{ padding: "12px 16px", fontWeight: 700, color: "#059669" }}>{money(s.amount)}</td>
                            <td style={{ padding: "12px 16px", color: "#64748B", textTransform: "capitalize" }}>{s.method?.replace("_", " ")}</td>
                            <td style={{ padding: "12px 16px", color: "#64748B" }}>{s.order_count}</td>
                            <td style={{ padding: "12px 16px", color: "#94A3B8" }}>{s.recorded_by || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ margin: "0 0 16px", color: "#101828" }}>Add Delivery Partner</h3>
            {createError && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{createError}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Name *</label>
                <input style={field} value={newPartner.name} onChange={(e) => setNewPartner((p) => ({ ...p, name: e.target.value }))} placeholder="e.g., Quick Ride Couriers" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Contact (optional)</label>
                <input style={field} value={newPartner.contact} onChange={(e) => setNewPartner((p) => ({ ...p, contact: e.target.value }))} placeholder="07XXXXXXXX" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
              <button onClick={() => setShowAddModal(false)} style={{ ...ghostBtn, flex: 1 }} disabled={isCreating}>Cancel</button>
              <button onClick={handleCreatePartner} style={{ ...primaryBtn, flex: 1, padding: 11, opacity: isCreating ? 0.6 : 1 }} disabled={isCreating}>
                {isCreating ? "Saving..." : "Add Partner"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
