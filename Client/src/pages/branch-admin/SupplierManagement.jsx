import React, { useEffect, useState } from "react";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import ToastMessage from "../../components/branch-admin/ToastMessage";
import {
  getSuppliers,
  createSupplier,
  getPurchaseOrdersBySupplier,
  getPurchaseItemsByOrder,
  getPaymentsBySupplier,
  receivePurchaseOrder,
  recordSupplierPayment,
} from "../../services/api";

const money = (v) =>
  `LKR ${Number(v || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHODS = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["cheque", "Cheque"],
  ["bank_transfer", "Bank transfer"],
  ["online", "Online"],
];

const errorText = (e, fallback) =>
  e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;

const chip = (bg, fg) => ({
  padding: "4px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: "700",
  background: bg, color: fg, display: "inline-block",
});
const primaryBtn = {
  padding: "8px 16px", background: "#1565C0", color: "#fff", border: "none",
  borderRadius: "8px", fontWeight: "600", cursor: "pointer",
};
const ghostBtn = {
  padding: "10px 16px", background: "#fff", color: "#344054", border: "1px solid #D0D5DD",
  borderRadius: "10px", fontWeight: "600", cursor: "pointer",
};
const field = {
  width: "100%", padding: "11px 12px", borderRadius: "10px", border: "1px solid #D0D5DD",
  fontSize: "15px", outline: "none", boxSizing: "border-box",
};

/**
 * One supplier: what was ordered, what arrived, and what has been paid.
 *
 * Receiving and paying used to be two separate requests from this screen, and
 * the second never checked the first — a failed "received" still recorded a
 * payment. There was no way to take goods on credit either. Now receiving is a
 * single request that may or may not carry a payment, and whatever is owed can
 * be paid later, in as many parts as it takes.
 */
function SupplierDetailView({ supplier, onBack, showToast }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { mode: "receive" | "pay", order }
  const [payNow, setPayNow] = useState(true);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [pos, payments] = await Promise.all([
        getPurchaseOrdersBySupplier(supplier.sup_id),
        getPaymentsBySupplier(supplier.sup_id),
      ]);
      const detailed = await Promise.all(pos.map(async (po) => {
        const raw = await getPurchaseItemsByOrder(po.po_id).catch(() => []);
        const items = Array.isArray(raw) ? raw : raw?.data || [];
        const mine = payments.filter((p) => Number(p.po_id) === Number(po.po_id));
        const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
        const paid = mine.reduce((s, p) => s + Number(p.amount || 0), 0);
        return { ...po, items, payments: mine, total, paid, balance: Math.max(0, +(total - paid).toFixed(2)) };
      }));
      setOrders(detailed);
    } catch (e) {
      showToast(errorText(e, "Could not load this supplier's orders"), "error");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.sup_id]);

  const open = (mode, order) => {
    setDialog({ mode, order });
    setPayNow(true);
    setAmount(String(mode === "receive" ? order.total : order.balance));
    setMethod("cash");
    setDialogError("");
  };

  const confirm = async () => {
    const { mode, order } = dialog;
    setBusy(true);
    setDialogError("");
    try {
      if (mode === "receive") {
        await receivePurchaseOrder(order.po_id, payNow ? { amount: Number(amount), method } : undefined);
        showToast(payNow
          ? `Order #${order.po_id} received and paid — stock is up`
          : `Order #${order.po_id} received — ${money(order.total)} owed to ${supplier.sup_name}`);
      } else {
        await recordSupplierPayment({
          sup_id: supplier.sup_id, po_id: order.po_id, amount: Number(amount), method,
        });
        showToast(`Payment recorded against order #${order.po_id}`);
      }
      setDialog(null);
      await load();
    } catch (e) {
      setDialogError(errorText(e, "That did not go through"));
    } finally {
      setBusy(false);
    }
  };

  const owed = orders.reduce((s, o) => s + (o.status === "received" ? o.balance : 0), 0);
  const cap = dialog ? (dialog.mode === "receive" ? dialog.order.total : dialog.order.balance) : 0;
  const showPayment = dialog && (dialog.mode === "pay" || payNow);
  const amountOk = !showPayment || (Number(amount) > 0 && Number(amount) <= cap + 0.005);

  return (
    <div style={{ animation: "fadeIn 0.3s ease-in", position: "relative" }}>
      {dialog && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
          }}>
            <h3 style={{ margin: "0 0 6px 0", color: "#101828" }}>
              {dialog.mode === "receive" ? `Goods arrived — order #${dialog.order.po_id}` : `Pay order #${dialog.order.po_id}`}
            </h3>
            <p style={{ fontSize: "14px", color: "#667085", margin: "0 0 18px" }}>
              {dialog.mode === "receive"
                ? `Worth ${money(dialog.order.total)}. Marking it received puts every item into stock.`
                : `${money(dialog.order.balance)} still owed of ${money(dialog.order.total)}.`}
            </p>

            {dialog.mode === "receive" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "#344054" }}>
                  <input type="radio" checked={payNow} onChange={() => setPayNow(true)} /> Paying now
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "#344054" }}>
                  <input type="radio" checked={!payNow} onChange={() => setPayNow(false)} /> Pay later — on credit
                </label>
              </div>
            )}

            {showPayment && (
              <>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: 6, color: "#344054" }}>
                  Amount paid
                </label>
                <input style={{ ...field, marginBottom: 12 }} type="number" inputMode="decimal"
                  min="0" max={cap} value={amount} onChange={(e) => setAmount(e.target.value)} />
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: 6, color: "#344054" }}>
                  How
                </label>
                <select style={{ ...field, marginBottom: 12 }} value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {Number(amount) > 0 && Number(amount) < cap && (
                  <div style={{ fontSize: 13, color: "#92400E", marginBottom: 12 }}>
                    Part payment — {money(cap - Number(amount))} will still be owed.
                  </div>
                )}
              </>
            )}

            {dialogError && (
              <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 12 }}>{dialogError}</div>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => setDialog(null)} style={{ ...ghostBtn, flex: 1 }} disabled={busy}>
                Cancel
              </button>
              <button onClick={confirm} disabled={busy || !amountOk}
                style={{ ...primaryBtn, flex: 1, padding: "10px 16px", opacity: busy || !amountOk ? 0.6 : 1 }}>
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={onBack} style={{
        marginBottom: "20px", background: "none", border: "none", color: "#1565C0",
        fontWeight: "600", cursor: "pointer",
      }}>
        ← Back to Directory
      </button>

      <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", border: "1px solid #E4E7EC", marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 12px 0", color: "#101828" }}>{supplier.sup_name}</h2>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", color: "#667085", fontSize: "14px" }}>
          <span>📞 {supplier.sup_contact}</span>
          {supplier.sup_email && <span>📧 {supplier.sup_email}</span>}
          {supplier.sup_address && <span>📍 {supplier.sup_address}</span>}
        </div>
        {owed > 0 && (
          <div style={{ marginTop: 14, fontSize: 14, color: "#92400E", fontWeight: 600 }}>
            Owed to this supplier: {money(owed)}
          </div>
        )}
      </div>

      <h3 style={{ marginBottom: "16px", color: "#101828", fontSize: "18px" }}>Purchase History</h3>

      {loading ? (
        <p>Loading…</p>
      ) : orders.length === 0 ? (
        <p style={{ color: "#667085" }}>No purchase orders yet. Add one from “Add Inventory Item”.</p>
      ) : orders.map((order) => (
        <div key={order.po_id} style={{
          background: "#fff", borderRadius: "12px", border: "1px solid #EAECF0",
          marginBottom: "20px", overflow: "hidden",
        }}>
          <div style={{
            padding: "16px 24px", background: "#F9FAFB", borderBottom: "1px solid #EAECF0",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          }}>
            <div>
              <span style={{ fontWeight: "700", color: "#101828" }}>Order #{order.po_id}</span>
              <span style={{ marginLeft: "12px", fontSize: "13px", color: "#667085" }}>
                {order.order_date ? new Date(order.order_date).toLocaleDateString() : "—"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {order.status === "pending" ? (
                <>
                  <span style={chip("#FFFAEB", "#B54708")}>ORDERED</span>
                  <button style={primaryBtn} onClick={() => open("receive", order)}>Mark as received</button>
                </>
              ) : order.balance > 0 ? (
                <>
                  <span style={chip("#FEF3C7", "#92400E")}>OWES {money(order.balance)}</span>
                  <button style={primaryBtn} onClick={() => open("pay", order)}>Record payment</button>
                </>
              ) : (
                <span style={chip("#ECFDF3", "#027A48")}>RECEIVED · PAID</span>
              )}
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#667085", borderBottom: "1px solid #EAECF0" }}>
                <th style={{ padding: "12px 24px" }}>Item</th>
                <th style={{ padding: "12px 24px" }}>Quantity</th>
                <th style={{ padding: "12px 24px" }}>Unit Price</th>
                <th style={{ padding: "12px 24px" }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #F2F4F7" }}>
                  <td style={{ padding: "12px 24px", fontWeight: "500" }}>
                    {item.pro_id ? item.pro_name : item.rm_name}
                    {item.pro_id && <span style={{ marginLeft: 6, fontSize: 11, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "1px 6px" }}>resale</span>}
                  </td>
                  <td style={{ padding: "12px 24px" }}>{Number(item.qty)} {item.pro_id ? "units" : item.rm_unit}</td>
                  <td style={{ padding: "12px 24px" }}>{money(item.unit_price)}</td>
                  <td style={{ padding: "12px 24px", color: "#101828", fontWeight: "700" }}>{money(item.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#F9FAFB", fontSize: 13 }}>
                <td style={{ padding: "10px 24px", color: "#667085" }} colSpan={2}>
                  {order.payments.length
                    ? order.payments.map((p) => `${money(p.amount)} by ${String(p.method).replace("_", " ")}`).join(" · ")
                    : order.status === "received" ? "Nothing paid yet" : ""}
                </td>
                <td style={{ padding: "10px 24px", color: "#667085" }}>Paid {money(order.paid)}</td>
                <td style={{ padding: "10px 24px", fontWeight: 700, color: "#101828" }}>Total {money(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  );
}

const SupplierManagement = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  
  // New Supplier Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ sup_name: "", sup_contact: "", sup_email: "", sup_address: "" });
  const [isCreating, setIsCreating] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 4000);
  };

  const loadSuppliers = async () => {
    setIsLoading(true);
    try {
      const list = await getSuppliers();
      setSuppliers(Array.isArray(list) ? list : list?.suppliers || []);
    } catch (e) {
      showToast(errorText(e, "Failed to load suppliers"), "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleCreateSupplier = async () => {
    try {
      // Basic validation
      const name = (newSupplier.sup_name || "").trim();
      if (!name || name.length < 2) throw new Error("Supplier name must be at least 2 characters");
      
      const contact = (newSupplier.sup_contact || "").trim();
      if (!contact || contact.length < 7) throw new Error("Please enter a valid contact number");

      setIsCreating(true);
      await createSupplier({
        sup_name: name,
        sup_contact: contact,
        sup_email: newSupplier.sup_email?.trim() || undefined,
        sup_address: newSupplier.sup_address?.trim() || undefined,
      });

      showToast("Supplier created successfully!", "success");
      setShowAddModal(false);
      setNewSupplier({ sup_name: "", sup_contact: "", sup_email: "", sup_address: "" });
      loadSuppliers();
    } catch (err) {
      showToast(err.message || "Failed to create supplier", "error");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div style={{ display: "flex", background: "#F9FAFB", minHeight: "100vh" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header title="Suppliers" role="Branch Admin" />
        {toast.show && <ToastMessage message={toast.message} type={toast.type} />}
        
        {/* Add Supplier Modal */}
        {showAddModal && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}>
            <div style={{ background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
              <h3 style={{ margin: "0 0 16px 0", color: "#101828" }}>Add New Supplier</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748B", marginBottom: "4px" }}>Supplier Name *</label>
                  <input style={field} value={newSupplier.sup_name} onChange={(e) => setNewSupplier({...newSupplier, sup_name: e.target.value})} placeholder="e.g., Fresh Farms" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748B", marginBottom: "4px" }}>Contact Number *</label>
                  <input style={field} value={newSupplier.sup_contact} onChange={(e) => setNewSupplier({...newSupplier, sup_contact: e.target.value})} placeholder="07XXXXXXXX" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748B", marginBottom: "4px" }}>Email (optional)</label>
                  <input style={field} value={newSupplier.sup_email} onChange={(e) => setNewSupplier({...newSupplier, sup_email: e.target.value})} placeholder="supplier@example.com" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748B", marginBottom: "4px" }}>Address (optional)</label>
                  <input style={field} value={newSupplier.sup_address} onChange={(e) => setNewSupplier({...newSupplier, sup_address: e.target.value})} placeholder="Supplier Address" />
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                <button onClick={() => setShowAddModal(false)} style={{ ...ghostBtn, flex: 1 }} disabled={isCreating}>Cancel</button>
                <button onClick={handleCreateSupplier} style={{ ...primaryBtn, flex: 1, padding: "10px 16px", opacity: isCreating ? 0.6 : 1 }} disabled={isCreating}>
                  {isCreating ? "Saving..." : "Save Supplier"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: "30px", maxWidth: "1200px", margin: "0 auto" }}>
          {selectedSupplier ? (
            <SupplierDetailView
              supplier={selectedSupplier}
              onBack={() => setSelectedSupplier(null)}
              showToast={showToast}
            />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
                <div>
                  <h2 style={{ fontSize: "24px", fontWeight: "700", color: "#101828", margin: "0 0 4px 0" }}>Supplier Directory</h2>
                  <p style={{ color: "#667085", margin: 0 }}>What you have ordered, what has arrived, and what you still owe.</p>
                </div>
                <button 
                  onClick={() => setShowAddModal(true)}
                  style={{ background: "#1565C0", color: "#fff", border: "none", padding: "10px 20px", borderRadius: "10px", fontWeight: "600", cursor: "pointer", fontSize: "14px" }}
                >
                  + Add Supplier
                </button>
              </div>

              {isLoading ? (
                <p>Loading suppliers...</p>
              ) : suppliers.length === 0 ? (
                <p style={{ color: "#667085" }}>No suppliers yet. Click "+ Add Supplier" to create one.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
                  {suppliers.map((sup) => (
                    <div
                      key={sup.sup_id}
                      onClick={() => setSelectedSupplier(sup)}
                      style={{
                        background: "#fff", padding: "24px", borderRadius: "16px",
                        border: "1px solid #E4E7EC", cursor: "pointer", transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1565C0"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)" }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E4E7EC"; e.currentTarget.style.boxShadow = "none" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                        <div style={{
                          width: "40px", height: "40px", borderRadius: "10px", background: "#EEF2FF",
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px"
                        }}>
                          🏢
                        </div>
                        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#101828" }}>{sup.sup_name}</h3>
                      </div>
                      <div style={{ fontSize: "14px", color: "#475467", display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>📞 <span>{sup.sup_contact}</span></div>
                        {sup.sup_email && <div style={{ display: "flex", gap: "8px" }}>📧 <span>{sup.sup_email}</span></div>}
                        <div style={{ display: "flex", gap: "8px" }}>
                          📍 <span style={{ fontSize: "12px" }}>{sup.sup_address || "No address provided"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierManagement;
