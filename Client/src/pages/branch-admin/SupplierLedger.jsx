import React, { useState, useEffect, useMemo } from "react";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import ToastMessage from "../../components/branch-admin/ToastMessage";
import { useAuth } from "../../context/AuthContext";
import {
  getPurchaseOrdersBySupplier, getPurchaseItemsByOrder, getPaymentsBySupplier,
  recordSupplierPayment, getBranchById,
} from "../../services/api";
import { printSupplierInvoice } from "../../utils/printSupplierInvoice";

const SupplierLedger = () => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState({ key: "sup_name", dir: "asc" });

  // Modal State
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Outstanding orders this supplier can actually be paid against — a payment
  // with nowhere to attach was invisible everywhere except this page (see the
  // "Make a Payment" handler below for the full story).
  const [outstanding, setOutstanding] = useState([]);
  const [outstandingLoading, setOutstandingLoading] = useState(false);

  // Payment State
  const [payingPoId, setPayingPoId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [isPaying, setIsPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [branchName, setBranchName] = useState("");
  const recordedBy = [user?.u_fname, user?.u_lname].filter(Boolean).join(" ") || user?.u_email || "";

  useEffect(() => {
    const id = user?.b_id ?? user?.B_id;
    if (!id) return;
    getBranchById(id).then((b) => setBranchName(b?.B_name ?? b?.data?.B_name ?? "")).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.b_id, user?.B_id]);

  useEffect(() => {
    fetchLedger();
  }, []);

  const fetchWithAuth = (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = localStorage.getItem("token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { ...opts, headers, credentials: "include" });
  };

  const fetchLedger = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth("/api/suppliers/ledger");
      if (!res.ok) throw new Error("Failed to load ledger");
      const data = await res.json();
      setSuppliers(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  };

  const toggleSort = (key) => setSort((s) => ({
    key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc",
  }));

  const visibleSuppliers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = !q ? suppliers : suppliers.filter((s) => (s.sup_name || "").toLowerCase().includes(q));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "sup_name") return dir * String(a.sup_name || "").localeCompare(String(b.sup_name || ""));
      return dir * (Number(a[sort.key]) - Number(b[sort.key]));
    });
  }, [suppliers, searchTerm, sort]);

  const totals = useMemo(() => suppliers.reduce((acc, s) => ({
    purchased: acc.purchased + Number(s.total_purchased || 0),
    paid: acc.paid + Number(s.total_paid || 0),
    owed: acc.owed + Number(s.balance_due || 0),
  }), { purchased: 0, paid: 0, owed: 0 }), [suppliers]);

  const handleRowClick = async (sup) => {
    setSelectedSupplier(sup);
    setHistoryLoading(true);
    setPayingPoId("");
    setPaymentAmount("");
    try {
      const res = await fetchWithAuth(`/api/suppliers/${sup.sup_id}/history`);
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setHistoryLoading(false);
    }
    await loadOutstanding(sup.sup_id);
  };

  // What this supplier can actually be paid against — received orders with a
  // balance still owed. A payment has to name one of these; see the note on
  // handleMakePayment for why that isn't optional.
  const loadOutstanding = async (supId) => {
    setOutstandingLoading(true);
    try {
      const pos = await getPurchaseOrdersBySupplier(supId);
      const payments = await getPaymentsBySupplier(supId).catch(() => []);
      const received = (Array.isArray(pos) ? pos : []).filter((po) => po.status === "received");
      const detailed = await Promise.all(received.map(async (po) => {
        const raw = await getPurchaseItemsByOrder(po.po_id).catch(() => []);
        const items = Array.isArray(raw) ? raw : raw?.data || [];
        const mine = (payments || []).filter((p) => Number(p.po_id) === Number(po.po_id));
        const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
        const paid = mine.reduce((s, p) => s + Number(p.amount || 0), 0);
        return { po_id: po.po_id, items, total, paid, balance: Math.max(0, +(total - paid).toFixed(2)) };
      }));
      setOutstanding(detailed.filter((o) => o.balance > 0.005));
    } catch {
      setOutstanding([]);
    } finally {
      setOutstandingLoading(false);
    }
  };

  // A payment with no purchase order behind it used to be recorded anyway
  // (po_id left NULL) — it showed up right here, and nowhere else, because
  // every other report and ledger in the system reads supplier payments
  // through a join to the order they were paid against. Money would leave
  // the books here and vanish from Accounting, Reports and the Financial
  // Ledger. Every payment now names the order it settles, through the same
  // validated endpoint the Suppliers page uses.
  const handleMakePayment = async () => {
    if (!payingPoId) {
      showToast("Choose which order this payment is against.", "error");
      return;
    }
    const order = outstanding.find((o) => String(o.po_id) === String(payingPoId));
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      showToast("Please enter a valid payment amount.", "error");
      return;
    }
    if (order && Number(paymentAmount) > order.balance + 0.005) {
      showToast(`That is more than is owed on this order (LKR ${order.balance.toFixed(2)}).`, "error");
      return;
    }

    setIsPaying(true);
    try {
      await recordSupplierPayment({
        sup_id: selectedSupplier.sup_id,
        po_id: Number(payingPoId),
        amount: Number(paymentAmount),
        method: paymentMethod,
      });

      showToast("Payment recorded successfully", "success");
      if (order) {
        setReceipt({
          branchName,
          supplierName: selectedSupplier.sup_name,
          supplierContact: selectedSupplier.sup_contact,
          poId: order.po_id,
          items: order.items.map((i) => ({
            name: i.pro_id ? i.pro_name : i.rm_name,
            qty: i.qty,
            unit: i.pro_id ? "units" : i.rm_unit,
            lineTotal: i.price,
          })),
          orderTotal: order.total,
          paidThisTime: Number(paymentAmount),
          paidToDate: order.paid + Number(paymentAmount),
          method: paymentMethod,
          recordedBy,
        });
      }
      setPaymentAmount("");
      setPayingPoId("");

      // Refresh Data
      handleRowClick(selectedSupplier);
      fetchLedger();
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || "Payment failed", "error");
    } finally {
      setIsPaying(false);
    }
  };

  // --- STYLES ---
  // width: "100%" matters here, not just maxWidth — this div is a flex item
  // inside a flex-column parent, and margin:auto on a flex item overrides the
  // default stretch behavior. Without an explicit width it shrinks to fit its
  // own content instead of filling out to maxWidth, so the page reads as
  // narrow no matter what maxWidth says.
  const containerStyle = { padding: "30px", maxWidth: "1600px", width: "100%", boxSizing: "border-box", margin: "0 auto", fontFamily: "'Inter', sans-serif" };
  const cardStyle = { background: "#fff", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", overflow: "hidden" };
  const headerStyle = { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" };
  const thStyle = { padding: "16px 24px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "#64748B", textTransform: "uppercase", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" };
  const tdStyle = { padding: "16px 24px", fontSize: "14px", color: "#1E293B", borderBottom: "1px solid #E2E8F0" };
  const primaryBtnStyle = { background: "#1565C0", color: "white", padding: "10px 20px", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" };
  const inputStyle = { padding: "10px", borderRadius: "6px", border: "1px solid #D0D5DD", fontSize: "14px" };

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#F1F5F9" }}>
      <style>{`
        @keyframes supplierDrawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
      <Sidebar />
      {/* Sidebar is position:fixed (see Sidebar.jsx) — every other page offsets
          with marginLeft: var(--sidebar-w), this one never had it, so content
          rendered underneath the sidebar. Only looked fine before because the
          content was accidentally shrink-wrapped narrow enough to center past
          the overlap by luck, not because this was actually correct. */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header />
        
        {toast.show && <ToastMessage message={toast.message} type={toast.type} onClose={() => setToast({ show: false })} />}

        <div style={containerStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <div>
              <h2 style={{ margin: 0, color: "#1E293B", fontSize: "24px", fontWeight: "700" }}>Supplier Ledger</h2>
              <p style={{ margin: "4px 0 0 0", color: "#64748B", fontSize: "14px" }}>Track supplier balances, invoices, and payments</p>
            </div>
          </div>

          {!loading && suppliers.length > 0 && (
            <div style={{ display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
              {[
                ["Total Purchases", totals.purchased, "#1E293B"],
                ["Total Paid", totals.paid, "#16A34A"],
                ["Total Owed", totals.owed, totals.owed > 0.005 ? "#DC2626" : "#16A34A"],
              ].map(([label, val, color]) => (
                <div key={label} style={{ ...cardStyle, flex: "1 1 180px", padding: "16px 20px" }}>
                  <div style={{ fontSize: "12px", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color, marginTop: 4 }}>
                    {val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && suppliers.length > 0 && (
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search suppliers by name…"
              style={{ ...inputStyle, width: "100%", maxWidth: 360, marginBottom: 16, display: "block" }}
            />
          )}

          <div>
            {/* The supplier list always uses the full width now — the detail
                view opens as a drawer over it instead of squeezing it down,
                so a wide screen doesn't sit half-empty when nothing's selected. */}
            <div style={cardStyle}>
              <div style={headerStyle}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#1E293B" }}>All Suppliers</h3>
              </div>
              {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>Loading ledger...</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        ["sup_name", "Supplier Name"],
                        ["total_purchased", "Total Purchases"],
                        ["total_paid", "Total Paid"],
                        ["balance_due", "Balance Due"],
                      ].map(([key, label]) => (
                        <th key={key} onClick={() => toggleSort(key)} style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}>
                          {label}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSuppliers.map(sup => {
                      const balance = Number(sup.balance_due);
                      return (
                        <tr 
                          key={sup.sup_id} 
                          onClick={() => handleRowClick(sup)}
                          style={{ 
                            cursor: "pointer", 
                            background: selectedSupplier?.sup_id === sup.sup_id ? "#EFF6FF" : "#fff",
                            transition: "background 0.2s"
                          }}
                          onMouseEnter={e => { if (selectedSupplier?.sup_id !== sup.sup_id) e.currentTarget.style.background = "#F8FAFC" }}
                          onMouseLeave={e => { if (selectedSupplier?.sup_id !== sup.sup_id) e.currentTarget.style.background = "#fff" }}
                        >
                          <td style={tdStyle}>
                            <div style={{ fontWeight: "600" }}>{sup.sup_name}</div>
                            <div style={{ fontSize: "12px", color: "#64748B" }}>{sup.sup_contact}</div>
                          </td>
                          <td style={tdStyle}>{Number(sup.total_purchased).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={tdStyle}>{Number(sup.total_paid).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={tdStyle}>
                            {balance > 0.005 ? (
                              <span style={{ background: "#FEF3F2", color: "#B42318", fontSize: "12px", fontWeight: 700,
                                padding: "4px 10px", borderRadius: "999px", whiteSpace: "nowrap" }}>
                                {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} owed
                              </span>
                            ) : (
                              <span style={{ background: "#ECFDF3", color: "#067647", fontSize: "12px", fontWeight: 700,
                                padding: "4px 10px", borderRadius: "999px", whiteSpace: "nowrap" }}>
                                Settled
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {suppliers.length === 0 && (
                      <tr>
                        <td colSpan="4" style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>No suppliers found.</td>
                      </tr>
                    )}
                    {suppliers.length > 0 && visibleSuppliers.length === 0 && (
                      <tr>
                        <td colSpan="4" style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>No suppliers match "{searchTerm}".</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Supplier Details & History — a drawer over the table, not a
                second column, so the table itself never has to shrink. */}
            {selectedSupplier && (
              <div onClick={() => setSelectedSupplier(null)} style={{
                position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 900,
              }} />
            )}
            {selectedSupplier && (
              <div style={{
                position: "fixed", top: 0, right: 0, height: "100vh", width: "min(460px, 100vw)",
                background: "#fff", zIndex: 901, boxShadow: "-12px 0 32px rgba(0,0,0,0.15)",
                overflowY: "auto", animation: "supplierDrawerIn 0.22s ease-out",
              }}>
                <div style={{
                  padding: "24px", background: "linear-gradient(135deg, #1565C0, #0D47A1)", color: "#fff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: "12px", background: "rgba(255,255,255,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0,
                      }}>
                        🏢
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{selectedSupplier.sup_name}</h3>
                        <div style={{ fontSize: "12px", opacity: 0.75, marginTop: 2 }}>{selectedSupplier.sup_contact}</div>
                      </div>
                    </div>
                    <button onClick={() => setSelectedSupplier(null)} style={{
                      background: "rgba(255,255,255,0.15)", border: "none", width: 28, height: 28, borderRadius: "50%",
                      fontSize: "16px", cursor: "pointer", color: "#fff", lineHeight: 1,
                    }}>×</button>
                  </div>
                  {(() => {
                    const bal = Number(suppliers.find(s => s.sup_id === selectedSupplier.sup_id)?.balance_due || 0);
                    return (
                      <div style={{ marginTop: "18px" }}>
                        <div style={{ fontSize: "11px", opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
                          Current Balance
                        </div>
                        <div style={{ fontSize: "26px", fontWeight: 700, marginTop: 2 }}>
                          LKR {bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <span style={{
                          display: "inline-block", marginTop: "6px", fontSize: "11px", fontWeight: 700,
                          padding: "3px 10px", borderRadius: "999px",
                          background: bal > 0.005 ? "rgba(220,38,38,0.25)" : "rgba(22,163,74,0.25)",
                        }}>
                          {bal > 0.005 ? "Balance owed" : "Settled"}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div style={{ padding: "24px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#334155" }}>Make a Payment</h4>
                  {outstandingLoading ? (
                    <div style={{ color: "#64748B", fontSize: 13 }}>Loading outstanding orders…</div>
                  ) : outstanding.length === 0 ? (
                    <div style={{ color: "#16A34A", fontSize: 13, fontWeight: 600 }}>Nothing owed to this supplier.</div>
                  ) : (
                    <>
                      <select
                        style={{ ...inputStyle, width: "100%", marginBottom: 10, boxSizing: "border-box" }}
                        value={payingPoId}
                        onChange={e => {
                          const id = e.target.value;
                          setPayingPoId(id);
                          const po = outstanding.find(o => String(o.po_id) === id);
                          setPaymentAmount(po ? String(po.balance) : "");
                        }}
                      >
                        <option value="">Which order is this against?</option>
                        {outstanding.map(po => (
                          <option key={po.po_id} value={po.po_id}>
                            Order #{po.po_id} — owes LKR {po.balance.toFixed(2)} of {po.total.toFixed(2)}
                          </option>
                        ))}
                      </select>
                      <div style={{ display: "flex", gap: "12px" }}>
                        <input
                          type="number"
                          style={{ ...inputStyle, flex: 1 }}
                          placeholder="Amount (LKR)"
                          value={paymentAmount}
                          max={outstanding.find(o => String(o.po_id) === String(payingPoId))?.balance}
                          onChange={e => setPaymentAmount(e.target.value)}
                        />
                        <select
                          style={inputStyle}
                          value={paymentMethod}
                          onChange={e => setPaymentMethod(e.target.value)}
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="bank_transfer">Bank Transfer</option>
                          <option value="cheque">Cheque</option>
                        </select>
                        <button
                          style={{ ...primaryBtnStyle, opacity: (isPaying || !payingPoId) ? 0.7 : 1 }}
                          onClick={handleMakePayment}
                          disabled={isPaying || !payingPoId}
                        >
                          {isPaying ? "Processing..." : "Pay Now"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ padding: "24px", maxHeight: "500px", overflowY: "auto" }}>
                  <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#334155" }}>Transaction History</h4>
                  
                  {historyLoading ? (
                    <div style={{ color: "#64748B", textAlign: "center", padding: "20px" }}>Loading history...</div>
                  ) : history.length === 0 ? (
                    <div style={{ color: "#64748B", textAlign: "center", padding: "20px" }}>No transactions yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {history.map((tx, idx) => (
                        <div key={idx} style={{ 
                          display: "flex", 
                          justifyContent: "space-between", 
                          alignItems: "center",
                          padding: "16px",
                          background: tx.type === 'payment' ? "#ECFDF5" : "#F8FAFC",
                          border: `1px solid ${tx.type === 'payment' ? "#A7F3D0" : "#E2E8F0"}`,
                          borderRadius: "8px"
                        }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "16px" }}>{tx.type === 'payment' ? '💸' : '📦'}</span>
                              <strong style={{ color: "#1E293B", fontSize: "14px" }}>{tx.description}</strong>
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
                              {new Date(tx.date).toLocaleString()}
                            </div>
                          </div>
                          
                          <div style={{ 
                            fontWeight: "700", 
                            fontSize: "15px",
                            color: tx.type === 'payment' ? "#10B981" : "#1E293B" 
                          }}>
                            {tx.type === 'payment' ? '-' : '+'} {Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment recorded — offer the invoice, print it or move on. */}
      {receipt && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", textAlign: "center",
          }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <h3 style={{ margin: "0 0 6px 0", color: "#101828" }}>Payment recorded</h3>
            <p style={{ fontSize: "14px", color: "#667085", margin: "0 0 20px" }}>
              LKR {receipt.paidThisTime.toFixed(2)} paid to {receipt.supplierName} against order #{receipt.poId}.
              {receipt.paidToDate < receipt.orderTotal - 0.005
                ? ` LKR ${(receipt.orderTotal - receipt.paidToDate).toFixed(2)} still owed.`
                : " Paid in full."}
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => setReceipt(null)} style={{ ...primaryBtnStyle, background: "#fff", color: "#344054", border: "1px solid #D0D5DD", flex: 1 }}>
                Done
              </button>
              <button onClick={() => printSupplierInvoice(receipt)} style={{ ...primaryBtnStyle, flex: 1 }}>
                🖨️ Print Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierLedger;
