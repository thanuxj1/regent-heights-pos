import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import StatCard from "../../components/branch-admin/StatCard";
import { getMealPlans, createMealPlan, updateMealPlan, getMealPlanStats } from "../../services/api";
import { card, input, btn, errorBox, money, modalWrap, modalBox } from "./ui";

const blankForm = { plan_code: "", plan_name: "", supplement_per_adult: "", supplement_per_child: "" };

const initials = (code) => (code || "?").trim().slice(0, 3).toUpperCase();
// Same idea as Delivery Partners' avatar palette — a stable hash of the
// code always lands on the same color, without storing one.
const AVATAR_PALETTE = [
  ["#EEF4FF", "#3538CD"], ["#ECFDF3", "#067647"], ["#FEF6EE", "#B93815"],
  ["#FDF2FA", "#C11574"], ["#F0F9FF", "#026AA2"], ["#FEF3F2", "#B42318"],
];
const avatarColors = (code) => {
  let h = 0;
  for (const ch of code || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};

/** One plan: what it's used for (bookings, revenue) and its own edit form. */
function MealPlanDetailView({ plan, onBack, onSaved }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getMealPlanStats(plan.plan_id).then(setStats).catch(() => setStats(null));
  }, [plan.plan_id]);

  const [form, setForm] = useState({
    plan_code: plan.plan_code, plan_name: plan.plan_name,
    supplement_per_adult: plan.supplement_per_adult, supplement_per_child: plan.supplement_per_child,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [togglingActive, setTogglingActive] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.plan_code.trim() || !form.plan_name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSaved(plan.plan_id, form);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save this meal plan.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    setTogglingActive(true);
    try { await onSaved(plan.plan_id, { is_active: !plan.is_active }); }
    finally { setTogglingActive(false); }
  };

  const [bg, fg] = avatarColors(plan.plan_code);

  return (
    <div style={{ animation: "fadeIn 0.2s ease-in" }}>
      <button onClick={onBack} style={{ marginBottom: 16, background: "none", border: "none", color: "#1565C0", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
        ← Back to Meal Plans
      </button>

      <div style={{ ...card, padding: 24, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>
            {initials(plan.plan_code)}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#101828" }}>{plan.plan_name}</h2>
            <div style={{ color: "#667085", fontSize: 13, marginTop: 2 }}>
              {money(plan.supplement_per_adult)}/adult · {money(plan.supplement_per_child)}/child
            </div>
          </div>
        </div>
        <button onClick={toggleActive} disabled={togglingActive}
          style={{ padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
            background: plan.is_active ? "#ECFDF3" : "#F2F4F7", color: plan.is_active ? "#067647" : "#667085", opacity: togglingActive ? 0.6 : 1 }}>
          {plan.is_active ? "● Active" : "○ Inactive — click to reactivate"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard title="Bookings Using This Plan" value={stats ? stats.bookings_count : "—"} icon="🛎️" iconClass="bg-blue-100 text-blue-700" showAction={false} onClick={() => {}} />
        <StatCard title="Total Revenue" value={stats ? money(stats.total_revenue) : "—"} icon="💵" iconClass="bg-emerald-100 text-emerald-700" showAction={false} onClick={() => {}} />
      </div>

      <div style={{ ...card, padding: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 14 }}>Edit Plan</div>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSave}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Code
              <input style={{ ...input, marginTop: 4 }} value={form.plan_code}
                onChange={(e) => setForm((f) => ({ ...f, plan_code: e.target.value.toUpperCase() }))}
                maxLength={10} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Name
              <input style={{ ...input, marginTop: 4 }} value={form.plan_name}
                onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
                maxLength={60} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Per Adult (LKR)
              <input type="number" min={0} step="0.01" style={{ ...input, marginTop: 4 }} value={form.supplement_per_adult}
                onChange={(e) => setForm((f) => ({ ...f, supplement_per_adult: e.target.value }))} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Per Child (LKR)
              <input type="number" min={0} step="0.01" style={{ ...input, marginTop: 4 }} value={form.supplement_per_child}
                onChange={(e) => setForm((f) => ({ ...f, supplement_per_child: e.target.value }))} />
            </label>
          </div>
          <button type="submit" disabled={saving || !form.plan_code.trim() || !form.plan_name.trim()}
            style={{ ...btn("primary"), width: "100%", padding: 11, opacity: saving || !form.plan_code.trim() || !form.plan_name.trim() ? 0.6 : 1 }}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Meal plan categories — Room Only, Bed & Breakfast, Half Board, Full
 * Board, or anything else a property wants to offer. Front desk picks one
 * of these (optionally) at check-in; what each one costs per adult/child,
 * how many bookings use it, and how much it's brought in are all defined
 * and shown here.
 */
export default function MealPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMealPlans();
      setPlans(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load meal plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedPlan = useMemo(() => plans.find((p) => p.plan_id === selectedId) || null, [plans, selectedId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.plan_code.trim() || !form.plan_name.trim()) return;
    try {
      setAdding(true);
      setError("");
      await createMealPlan(form);
      setForm(blankForm);
      setShowAddModal(false);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not add that meal plan.");
    } finally {
      setAdding(false);
    }
  };

  const handleSaved = async (planId, payload) => {
    await updateMealPlan(planId, payload);
    await load();
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Meal Plan Categories" />

        <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {error && <div style={errorBox}>{error}</div>}

          {selectedPlan ? (
            <MealPlanDetailView plan={selectedPlan} onBack={() => setSelectedId(null)} onSaved={handleSaved} />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "#101828" }}>Meal Plan Categories</div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748B", maxWidth: 520 }}>
                    Room Only, Bed &amp; Breakfast, Half Board, Full Board — or anything
                    else this property offers. Front desk can optionally choose one at
                    check-in.
                  </p>
                </div>
                <button onClick={() => { setForm(blankForm); setShowAddModal(true); }} style={{ ...btn("primary"), padding: "10px 18px", whiteSpace: "nowrap" }}>
                  <FaPlus size={11} style={{ marginRight: 6 }} />
                  Add Plan
                </button>
              </div>

              {loading ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8" }}>Loading...</div>
              ) : plans.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8" }}>No meal plans yet. Click "Add Plan" to create one.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
                  {plans.map((p) => {
                    const [bg, fg] = avatarColors(p.plan_code);
                    return (
                      <div key={p.plan_id} onClick={() => setSelectedId(p.plan_id)}
                        style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2E8F0", cursor: "pointer", overflow: "hidden", opacity: p.is_active ? 1 : 0.55, transition: "transform 0.15s, box-shadow 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 10px 20px rgba(16,24,40,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        <div style={{ padding: "18px 20px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                            {initials(p.plan_code)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#101828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.plan_name}</div>
                            <div style={{ fontSize: 12, color: "#667085" }}>{p.is_active ? p.plan_code : "Inactive"}</div>
                          </div>
                        </div>
                        <div style={{ padding: "10px 20px", borderTop: "1px solid #F2F4F7", background: "#F9FAFB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#667085", fontWeight: 600 }}>Supplement</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#101828" }}>
                            {money(p.supplement_per_adult)} <span style={{ fontWeight: 400, color: "#94A3B8" }}>/adult</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {showAddModal && (
        <div style={modalWrap}>
          <div style={modalBox(420)}>
            <h3 style={{ margin: "0 0 16px", color: "#101828" }}>Add Meal Plan</h3>
            <form onSubmit={handleAdd}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Code
                  <input style={{ ...input, marginTop: 4 }} value={form.plan_code}
                    onChange={(e) => setForm((f) => ({ ...f, plan_code: e.target.value.toUpperCase() }))}
                    placeholder="HB" maxLength={10} autoFocus />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Name
                  <input style={{ ...input, marginTop: 4 }} value={form.plan_name}
                    onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
                    placeholder="Half Board" maxLength={60} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Per Adult
                    <input type="number" min={0} step="0.01" style={{ ...input, marginTop: 4 }} value={form.supplement_per_adult}
                      onChange={(e) => setForm((f) => ({ ...f, supplement_per_adult: e.target.value }))}
                      placeholder="0.00" />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Per Child
                    <input type="number" min={0} step="0.01" style={{ ...input, marginTop: 4 }} value={form.supplement_per_child}
                      onChange={(e) => setForm((f) => ({ ...f, supplement_per_child: e.target.value }))}
                      placeholder="0.00" />
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
                <button type="button" onClick={() => setShowAddModal(false)} style={{ ...btn("ghost"), flex: 1 }} disabled={adding}>Cancel</button>
                <button type="submit" disabled={adding || !form.plan_code.trim() || !form.plan_name.trim()}
                  style={{ ...btn("primary"), flex: 1, padding: 11, opacity: adding || !form.plan_code.trim() || !form.plan_name.trim() ? 0.6 : 1 }}>
                  {adding ? "Adding…" : "Add Plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
