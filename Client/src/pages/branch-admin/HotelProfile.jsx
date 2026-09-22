import React, { useEffect, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import { useAuth } from "../../context/AuthContext";
import { getBranchById, updateBranch, getStayPolicy, updateStayPolicy } from "../../services/api";
import { card, input, label, btn, errorBox } from "../hotel/ui";
import DrawerPinCard from "../../components/branch-admin/DrawerPinCard";

/**
 * The property's own details — the name, address and phone that print on every
 * bill, invoice and WhatsApp confirmation.
 *
 * Deliberately *not* the admin branch page: that one manages branch admins,
 * passwords and deletion, none of which belong to an owner editing their own
 * hotel. This shows the four fields that appear on paperwork, nothing else.
 */
export default function HotelProfile() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [form, setForm] = useState({ B_name: "", B_address: "", B_conNo: "", B_email: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [policy, setPolicy] = useState(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);
  const [policyError, setPolicyError] = useState("");

  useEffect(() => {
    if (!branchId) { setLoading(false); setError("No property is linked to this account."); return; }
    let alive = true;
    (async () => {
      try {
        const b = await getBranchById(branchId);
        if (!alive) return;
        setForm({
          B_name:    b?.B_name    ?? "",
          B_address: b?.B_address ?? "",
          B_conNo:   b?.B_conNo   ?? "",
          B_email:   b?.B_email   ?? "",
        });
        try {
          const p = await getStayPolicy();
          if (alive) setPolicy(p);
        } catch { /* the stay policy is optional; the details still load without it */ }
      } catch (err) {
        if (alive) setError(err?.response?.data?.message || "Could not load your property details.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [branchId]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setSaved(false);
  };

  const setP = (k) => (e) => {
    const v = e.target.value;
    setPolicy((p) => ({ ...p, [k]: v }));
    setPolicySaved(false);
  };

  const savePolicy = async (e) => {
    e.preventDefault();
    setPolicyError("");
    setSavingPolicy(true);
    try {
      setPolicy(await updateStayPolicy(policy));
      setPolicySaved(true);
    } catch (err) {
      setPolicyError(err?.response?.data?.message || "Could not save the stay policy.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateBranch(branchId, form);
      setSaved(true);
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.errors?.join(" ") || data?.message || "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Hotel Profile" />
        <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          <div style={{ ...card, maxWidth: 640, padding: 28 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
              Your property
            </h2>
            <p style={{ margin: "0 0 22px", fontSize: 13, color: "#64748B" }}>
              These details appear on printed bills, invoices and booking confirmations.
            </p>

            {error && <div style={errorBox}>{error}</div>}

            {loading ? (
              <p style={{ color: "#64748B", fontSize: 13 }}>Loading…</p>
            ) : (
              <form onSubmit={save}>
                <Field label="Hotel Name"     value={form.B_name}    onChange={set("B_name")} required />
                <Field label="Address"        value={form.B_address} onChange={set("B_address")} />
                <Field label="Contact Number" value={form.B_conNo}   onChange={set("B_conNo")} />
                <Field label="Email"          value={form.B_email}   onChange={set("B_email")} type="email" />

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 24 }}>
                  <button type="submit" style={{ ...btn("primary"), opacity: saving ? 0.6 : 1 }} disabled={saving}>
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  {saved && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Saved</span>
                  )}
                </div>
              </form>
            )}
          </div>

          {policy && (
            <div style={{ ...card, maxWidth: 640, padding: 28, marginTop: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
                Stay policy
              </h2>
              <p style={{ margin: "0 0 22px", fontSize: 13, color: "#64748B" }}>
                The times printed on every confirmation, and what a guest is charged for leaving late.
              </p>
              {!policy.policy_saved && (
                <div style={{ margin: "-6px 0 18px", padding: "10px 12px", borderRadius: 8, background: "#EFF6FF",
                              border: "1px solid #BFDBFE", color: "#1E40AF", fontSize: 12.5, lineHeight: 1.5 }}>
                  You haven&apos;t saved these yet. The values below are only starting suggestions, so until you press
                  <strong> Save Policy</strong> your check-in and check-out times, cancellation rule and terms are left
                  off booking confirmations.
                </div>
              )}

              {policyError && <div style={errorBox}>{policyError}</div>}

              <form onSubmit={savePolicy}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Check-In From"  type="time" value={policy.check_in_time?.slice(0, 5) || ""}  onChange={setP("check_in_time")} />
                  <Field label="Check-Out By"   type="time" value={policy.check_out_time?.slice(0, 5) || ""} onChange={setP("check_out_time")} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <Field label="Tax on room charges (%)" type="number" min={0} max={100} step="0.01"
                    value={policy.default_tax_pct ?? 0} onChange={setP("default_tax_pct")} />
                  <p style={{ margin: "-8px 0 0", fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
                    New bookings start with this rate. Leave it at 0 if you don&apos;t charge tax; you can still change it
                    on any single booking.
                  </p>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ ...label, marginBottom: 6 }}>Late Check-Out Charge</label>
                  <select style={input} value={policy.late_mode} onChange={setP("late_mode")}>
                    <option value="none">Not charged — only recorded</option>
                    <option value="hourly">Per hour, as a share of the nightly rate</option>
                    <option value="flat">One fixed fee</option>
                    <option value="night">A full extra night</option>
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Free Grace Period (minutes)" type="number" min={0} max={720}
                    value={policy.late_grace_minutes} onChange={setP("late_grace_minutes")} />
                  {policy.late_mode === "hourly" && (
                    <Field label="Per Hour (% of nightly rate)" type="number" min={0} max={100} step="0.01"
                      value={policy.late_hourly_pct} onChange={setP("late_hourly_pct")} />
                  )}
                  {policy.late_mode === "flat" && (
                    <Field label="Fixed Fee (LKR)" type="number" min={0} step="0.01"
                      value={policy.late_flat_amount} onChange={setP("late_flat_amount")} />
                  )}
                  {policy.late_mode === "hourly" && (
                    <Field label="Charge a Full Night After (hours)" type="number" min={1} max={24}
                      value={policy.late_full_night_after} onChange={setP("late_full_night_after")} />
                  )}
                </div>

                <p style={{ margin: "4px 0 14px", fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
                  {policyBlurb(policy)}
                </p>

                <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Free Cancellation Up To (hours before arrival)" type="number" min={0} max={720}
                      value={policy.cancel_free_hours} onChange={setP("cancel_free_hours")} />
                    <Field label="Otherwise Charge (nights)" type="number" min={0} max={30}
                      value={policy.cancel_charge_nights} onChange={setP("cancel_charge_nights")} />
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
                    Printed on every confirmation voucher and sent in every WhatsApp message:
                    <br /><em>{cancellationBlurb(policy)}</em>
                  </p>
                </div>

                <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #E2E8F0" }}>
                  <label style={{ ...label, marginBottom: 4 }} htmlFor="hp-terms">
                    Terms &amp; conditions on the booking confirmation
                  </label>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
                    One term per line. The check-in and check-out times and the cancellation rule above are always
                    printed first, so you don&apos;t need to write them again.
                  </p>
                  <textarea
                    id="hp-terms"
                    rows={6}
                    maxLength={1500}
                    style={{ ...input, resize: "vertical", lineHeight: 1.55, fontFamily: "inherit" }}
                    value={policy.extra_terms ?? ""}
                    onChange={setP("extra_terms")}
                    placeholder="e.g. Smoking is not permitted inside the rooms."
                  />
                  {(() => {
                    const count = String(policy.extra_terms ?? "").split(/\r?\n/).filter((l) => l.trim()).length;
                    return (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 12 }}>
                        <span style={{ color: count > 12 ? "#DC2626" : "#64748B" }}>{count} of 12 lines</span>
                        {policy.suggested_extra_terms && !String(policy.extra_terms ?? "").trim() && (
                          <button
                            type="button"
                            onClick={() => { setPolicy((p) => ({ ...p, extra_terms: p.suggested_extra_terms })); setPolicySaved(false); }}
                            style={{ background: "none", border: "none", padding: 0, color: "#1565C0", fontSize: 12,
                                     textDecoration: "underline", cursor: "pointer" }}
                          >
                            Insert suggested wording
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
                  <button type="submit" style={{ ...btn("primary"), opacity: savingPolicy ? 0.6 : 1 }} disabled={savingPolicy}>
                    {savingPolicy ? "Saving…" : "Save Policy"}
                  </button>
                  {policySaved && <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Saved</span>}
                </div>
              </form>
            </div>
          )}

          <DrawerPinCard />
        </main>
      </div>
    </div>
  );
}

/** Kept in step with cancellationLine() on the server, which writes the real thing. */
function cancellationBlurb(p) {
  const hours  = Number(p.cancel_free_hours ?? 48);
  const nights = Number(p.cancel_charge_nights ?? 1);
  if (!hours && !nights) return "Cancellation terms: please ask the front desk.";
  const free = hours
    ? `Free cancellation up to ${hours} hour${hours === 1 ? "" : "s"} before arrival`
    : "Cancellations are accepted at any time";
  return free + (nights ? `; otherwise a ${nights} night stay charge applies.` : "; no cancellation charge applies.");
}

/** The rule in a sentence, so the owner can check it reads the way they meant. */
function policyBlurb(p) {
  const out = p.check_out_time?.slice(0, 5) || "11:00";
  const grace = Number(p.late_grace_minutes) || 0;
  const after = grace ? `${out} plus ${grace} minutes' grace` : out;
  if (p.late_mode === "none")  return `Guests leaving after ${after} are recorded as late, but never charged.`;
  if (p.late_mode === "night") return `Any guest leaving after ${after} is charged a full extra night.`;
  if (p.late_mode === "flat")  return `Any guest leaving after ${after} is charged a fixed LKR ${Number(p.late_flat_amount || 0).toLocaleString()}.`;
  return `After ${after}, each hour started costs ${Number(p.late_hourly_pct || 0)}% of the nightly rate. `
       + `Past ${Number(p.late_full_night_after || 6)} hours it becomes a full extra night, and never more than that.`;
}

function Field({ label: text, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...label, marginBottom: 6 }}>{text}</label>
      <input style={input} {...props} />
    </div>
  );
}
