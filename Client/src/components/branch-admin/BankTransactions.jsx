import React, { useEffect, useMemo, useState } from "react";
import {
  getBankTransactions, createBankTransaction, updateBankTransaction, deleteBankTransaction,
  getBankCategories, createBankCategory, updateBankCategory, deleteBankCategory,
} from "../../services/api";
import { dayKey, todayKey } from "../../utils/dates";
import { exportCsv, dateCell } from "../../utils/exportCsv";

// The bank book: money paid into and taken out of the bank account. Kept apart
// from revenue and expenses — a sales deposit is sales the till already took.

const METHOD_LABEL = { cheque_withdrawal: "Cheque withdrawal", bank_transfer: "Bank transfer" };
const TRANSFER_LABEL = { online_payment: "Online payment", supplier_payment: "Supplier payment" };
const BUILTIN = ["Sales cash deposit", "MD cash deposit"];

function fmt(v) { return Number(v || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const blank = () => ({
  bt_date: todayKey(), bt_type: "debit", bt_method: "cheque_withdrawal", bt_transfer: "online_payment",
  bt_cheque_no: "", bt_category: BUILTIN[0], bt_amount: "", bt_note: "",
});

/** What the entry was, in words: "Cheque withdrawal · No. 004512", "Bank transfer · Supplier payment". */
export function detailOf(t) {
  if (t.bt_type === "credit") return t.bt_category;
  if (t.bt_method === "cheque_withdrawal") return `Cheque withdrawal · No. ${t.bt_cheque_no}`;
  return `Bank transfer · ${TRANSFER_LABEL[t.bt_transfer] || t.bt_transfer}`;
}

const input = { padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 13, background: "#fff" };
const field = { display: "block", width: "100%", marginTop: 4, padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" };
const label = { fontSize: 12, fontWeight: 600, color: "#64748B" };

/** A row of buttons that acts as a choice — easier to hit than a dropdown. */
function Choice({ value, onChange, options, colors = {} }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 8, marginTop: 4 }}>
      {options.map(([k, l]) => {
        const on = value === k;
        const c = colors[k] || "#1565C0";
        return (
          <button key={k} type="button" onClick={() => onChange(k)}
            style={{ padding: "9px 10px", borderRadius: 8, fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer",
              border: `1.5px solid ${on ? c : "#E2E8F0"}`, background: on ? `${c}12` : "#fff", color: on ? c : "#475569" }}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export default function BankTransactions({ branchId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [filterType, setFilterType] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [custom, setCustom] = useState([]);
  const [used, setUsed] = useState({});
  const allCats = useMemo(() => [...BUILTIN, ...custom.map((c) => c.name)], [custom]);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [showCats, setShowCats] = useState(false);
  const [catName, setCatName] = useState("");
  const [catEdit, setCatEdit] = useState(null); // { cat_id, name }
  const [catError, setCatError] = useState("");

  const loadCats = async () => {
    if (!branchId) return;
    try {
      const r = await getBankCategories({ b_id: branchId });
      setCustom(r.custom || []);
      setUsed(r.used || {});
    } catch { /* the two standard ones still work */ }
  };

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const params = { b_id: branchId };
      if (filterType !== "all") params.type = filterType;
      if (filterCat !== "all") params.category = filterCat;
      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;
      const r = await getBankTransactions(params);
      setRows(Array.isArray(r) ? r : []);
      setLoadError("");
    } catch (err) {
      setLoadError(err?.response?.data?.message || "The bank entries could not be loaded — try again.");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadCats(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId, filterType, filterCat, filterFrom, filterTo]);

  const credits = rows.filter((t) => t.bt_type === "credit").reduce((s, t) => s + Number(t.bt_amount), 0);
  const debits = rows.filter((t) => t.bt_type === "debit").reduce((s, t) => s + Number(t.bt_amount), 0);
  const net = credits - debits;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const openNew = () => { setForm(blank()); setEditingId(null); setError(""); setShowModal(true); };
  const openEdit = (t) => {
    setForm({
      ...blank(),
      bt_date: dayKey(t.bt_date), bt_type: t.bt_type, bt_amount: t.bt_amount, bt_note: t.bt_note || "",
      bt_method: t.bt_method || "cheque_withdrawal", bt_transfer: t.bt_transfer || "online_payment",
      bt_cheque_no: t.bt_cheque_no || "", bt_category: t.bt_category || BUILTIN[0],
    });
    setEditingId(t.bt_id); setError(""); setShowModal(true);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault(); setError("");
    if (!(Number(form.bt_amount) > 0)) { setError("Enter the amount."); return; }
    if (form.bt_type === "debit" && form.bt_method === "cheque_withdrawal" && !form.bt_cheque_no.trim()) {
      setError("Enter the cheque number."); return;
    }
    // Only what belongs to the chosen kind is sent.
    const payload = { b_id: branchId, bt_date: form.bt_date, bt_type: form.bt_type, bt_amount: Number(form.bt_amount), bt_note: form.bt_note };
    if (form.bt_type === "debit") {
      payload.bt_method = form.bt_method;
      if (form.bt_method === "cheque_withdrawal") payload.bt_cheque_no = form.bt_cheque_no.trim();
      else payload.bt_transfer = form.bt_transfer;
    } else payload.bt_category = form.bt_category;
    setSubmitting(true);
    try {
      if (editingId) await updateBankTransaction(editingId, payload);
      else await createBankTransaction(payload);
      setShowModal(false);
      await Promise.all([load(), loadCats()]);
    } catch (err) { setError(err?.response?.data?.message || err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (t) => {
    if (!confirm(`Delete this ${t.bt_type} of LKR ${fmt(t.bt_amount)} (${detailOf(t)})?`)) return;
    try { await deleteBankTransaction(t.bt_id); await Promise.all([load(), loadCats()]); }
    catch (err) { alert(err?.response?.data?.message || "Could not delete the entry"); }
  };

  const handleExport = () => {
    if (!rows.length) return;
    exportCsv(`bank_transactions_${dayKey(new Date())}`,
      ["Date", "Type", "Details", "Credit (LKR)", "Debit (LKR)", "Note", "Added By"],
      rows.map((t) => [
        dateCell(dayKey(t.bt_date)), t.bt_type === "credit" ? "Credit" : "Debit", detailOf(t),
        t.bt_type === "credit" ? t.bt_amount : "", t.bt_type === "debit" ? t.bt_amount : "",
        t.bt_note || "", t.created_by_name || "",
      ]));
  };

  const addCat = async (ev) => {
    ev.preventDefault(); setCatError("");
    try {
      const c = await createBankCategory({ name: catName, b_id: branchId });
      setCatName(""); await loadCats();
      // Opened from the form: the new one is what they meant to pick.
      if (showModal) setForm((f) => ({ ...f, bt_category: c.name }));
    } catch (err) { setCatError(err?.response?.data?.message || "Could not add the category"); }
  };
  const saveCat = async () => {
    setCatError("");
    try { await updateBankCategory(catEdit.cat_id, { name: catEdit.name }); setCatEdit(null); await Promise.all([loadCats(), load()]); }
    catch (err) { setCatError(err?.response?.data?.message || "Could not save the category"); }
  };
  const removeCat = async (c) => {
    if (!confirm(`Remove the category "${c.name}"?`)) return;
    setCatError("");
    try { await deleteBankCategory(c.cat_id); await loadCats(); }
    catch (err) { setCatError(err?.response?.data?.message || "Could not remove the category"); }
  };

  return (
    <>
      {loadError && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      )}

      {/* Totals for whatever the filters show */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "Credits (money in)", value: credits, color: "#065F46", bg: "#ECFDF5", border: "#A7F3D0" },
          { label: "Debits (money out)", value: debits, color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
          { label: "Difference", value: net, color: net >= 0 ? "#1565C0" : "#B91C1C", bg: "#EFF6FF", border: "#BFDBFE" },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>LKR {fmt(s.value)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); if (e.target.value === "debit") setFilterCat("all"); }} style={input}>
          <option value="all">Debits and credits</option>
          <option value="debit">Debits only</option>
          <option value="credit">Credits only</option>
        </select>
        {filterType !== "debit" && (
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={input}>
            <option value="all">All credit categories</option>
            {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={input} />
        <span style={{ color: "#94A3B8" }}>to</span>
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={input} />
        <button onClick={() => { setFilterType("all"); setFilterCat("all"); setFilterFrom(""); setFilterTo(""); }}
          style={{ ...input, cursor: "pointer", color: "#64748B" }}>Clear</button>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} disabled={!rows.length}
          style={{ ...input, cursor: rows.length ? "pointer" : "not-allowed", opacity: rows.length ? 1 : 0.5, color: "#475569", fontWeight: 600 }}>Export CSV</button>
        <button onClick={() => { setCatError(""); setShowCats(true); }}
          style={{ ...input, cursor: "pointer", color: "#475569", fontWeight: 600 }}>Categories</button>
        <button onClick={openNew}
          style={{ padding: "9px 18px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>+ Add Bank Entry</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>No bank entries found.</div>
      ) : (
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Date", "Type", "Details", "Credit", "Debit", "Note", "Added By", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: h === "Credit" || h === "Debit" ? "right" : "left", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const cr = t.bt_type === "credit";
                return (
                  <tr key={t.bt_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "12px 16px", color: "#475569", whiteSpace: "nowrap" }}>{dayKey(t.bt_date)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: cr ? "#D1FAE5" : "#FEE2E2", color: cr ? "#065F46" : "#B91C1C", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {cr ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#1E293B" }}>{detailOf(t)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#065F46" }}>{cr ? `LKR ${fmt(t.bt_amount)}` : ""}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#DC2626" }}>{cr ? "" : `LKR ${fmt(t.bt_amount)}`}</td>
                    <td style={{ padding: "12px 16px", color: "#64748B", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.bt_note || "—"}</td>
                    <td style={{ padding: "12px 16px", color: "#94A3B8" }}>{t.created_by_name || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => openEdit(t)} style={{ padding: "4px 10px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" }}>Edit</button>
                        <button onClick={() => handleDelete(t)} style={{ padding: "4px 10px", border: "1px solid #FECACA", borderRadius: 6, background: "#FEF2F2", cursor: "pointer", fontSize: 12, color: "#DC2626" }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0", fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "12px 16px", color: "#1E293B" }}>Total</td>
                <td style={{ padding: "12px 16px", textAlign: "right", color: "#065F46" }}>LKR {fmt(credits)}</td>
                <td style={{ padding: "12px 16px", textAlign: "right", color: "#DC2626" }}>LKR {fmt(debits)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add / edit an entry */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>{editingId ? "Edit Bank Entry" : "Add Bank Entry"}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 18, color: "#94A3B8", cursor: "pointer" }}>✕</button>
            </div>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={label}>Date *
                <input type="date" value={form.bt_date} onChange={(e) => set("bt_date")(e.target.value)} required style={field} />
              </label>

              <div style={label}>Transaction *
                <Choice value={form.bt_type} onChange={set("bt_type")}
                  options={[["debit", "Debit (money out)"], ["credit", "Credit (money in)"]]}
                  colors={{ debit: "#DC2626", credit: "#059669" }} />
              </div>

              {form.bt_type === "debit" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14, background: "#F8FAFC", borderRadius: 10 }}>
                  <div style={label}>Debit by *
                    <Choice value={form.bt_method} onChange={set("bt_method")}
                      options={[["cheque_withdrawal", "Cheque withdrawal"], ["bank_transfer", "Bank transfer"]]} />
                  </div>
                  {form.bt_method === "cheque_withdrawal" ? (
                    <label style={label}>Cheque number *
                      <input value={form.bt_cheque_no} maxLength={30} onChange={(e) => set("bt_cheque_no")(e.target.value)}
                        placeholder="e.g. 004512" autoFocus style={field} />
                    </label>
                  ) : (
                    <div style={label}>Transfer for *
                      <Choice value={form.bt_transfer} onChange={set("bt_transfer")}
                        options={[["online_payment", "Online payment"], ["supplier_payment", "Supplier payment"]]} />
                    </div>
                  )}
                </div>
              )}

              {form.bt_type === "credit" && (
                <div style={{ padding: 14, background: "#F8FAFC", borderRadius: 10 }}>
                  <label style={label}>Category *
                    <select value={form.bt_category} onChange={(e) => set("bt_category")(e.target.value)} style={field}>
                      {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => { setCatError(""); setShowCats(true); }}
                    style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: "#1565C0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    + Add a category of your own
                  </button>
                </div>
              )}

              <label style={label}>Amount (LKR) *
                <input type="number" min={0.01} step="0.01" value={form.bt_amount} onChange={(e) => set("bt_amount")(e.target.value)} required style={field} />
              </label>
              <label style={label}>Note
                <textarea value={form.bt_note} maxLength={500} onChange={(e) => set("bt_note")(e.target.value)} rows={2}
                  style={{ ...field, resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: 11, border: "1px solid #E2E8F0", borderRadius: 10, fontWeight: 600, color: "#64748B", background: "#fff", cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting}
                  style={{ flex: 1, padding: 11, border: "none", borderRadius: 10, fontWeight: 700, color: "#fff", background: "#1565C0", cursor: "pointer", opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? "Saving..." : editingId ? "Update" : "Add Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit categories */}
      {showCats && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Credit categories</h2>
              <button onClick={() => { setShowCats(false); setCatEdit(null); }} style={{ background: "none", border: "none", fontSize: 18, color: "#94A3B8", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>What money paid into the bank can be filed under.</div>
            {catError && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{catError}</div>}
            <form onSubmit={addCat} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input value={catName} maxLength={40} placeholder="e.g. Card settlement, Loan received"
                onChange={(e) => setCatName(e.target.value)}
                style={{ flex: 1, padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13 }} />
              <button type="submit" disabled={catName.trim().length < 2}
                style={{ padding: "9px 14px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, opacity: catName.trim().length < 2 ? 0.5 : 1 }}>Add</button>
            </form>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Your categories</div>
            {custom.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94A3B8", padding: "8px 0 14px" }}>None yet.</div>
            ) : custom.map((c) => (
              <div key={c.cat_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
                {catEdit?.cat_id === c.cat_id ? (
                  <>
                    <input value={catEdit.name} maxLength={40} onChange={(e) => setCatEdit((x) => ({ ...x, name: e.target.value }))}
                      style={{ flex: 1, padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }} />
                    <button onClick={saveCat} style={{ padding: "5px 10px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setCatEdit(null)} style={{ padding: "5px 10px", border: "1px solid #E2E8F0", background: "#fff", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, color: "#1E293B" }}>{c.name}</span>
                    <span style={{ color: "#94A3B8", fontSize: 12 }}>{c.used} entr{c.used === 1 ? "y" : "ies"}</span>
                    <button onClick={() => setCatEdit({ cat_id: c.cat_id, name: c.name })}
                      style={{ padding: "4px 10px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" }}>Edit</button>
                    <button onClick={() => removeCat(c)} disabled={c.used > 0}
                      title={c.used > 0 ? "Move its entries to another category first" : "Remove"}
                      style={{ padding: "4px 10px", border: "1px solid #FECACA", borderRadius: 6, background: "#FEF2F2", cursor: c.used > 0 ? "not-allowed" : "pointer", fontSize: 12, color: "#DC2626", opacity: c.used > 0 ? 0.4 : 1 }}>Remove</button>
                  </>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", margin: "16px 0 6px" }}>Standard</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {BUILTIN.map((c) => (
                <span key={c} style={{ background: "#F1F5F9", padding: "3px 10px", borderRadius: 20, fontSize: 12, color: "#475569" }}>
                  {c}{used[c] ? ` · ${used[c]}` : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
