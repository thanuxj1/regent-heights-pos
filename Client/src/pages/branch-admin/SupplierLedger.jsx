import React, { useState, useEffect } from "react";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import ToastMessage from "../../components/branch-admin/ToastMessage";
import { useAuth } from "../../context/AuthContext";

const SupplierLedger = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  // Modal State
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // Payment State
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [isPaying, setIsPaying] = useState(false);

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

  const handleRowClick = async (sup) => {
    setSelectedSupplier(sup);
    setHistoryLoading(true);
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
  };

  const handleMakePayment = async () => {
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      showToast("Please enter a valid payment amount.", "error");
      return;
    }
    
    setIsPaying(true);
    try {
      const res = await fetchWithAuth(`/api/suppliers/${selectedSupplier.sup_id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(paymentAmount),
          method: paymentMethod
        })
      });
      if (!res.ok) throw new Error("Payment failed");
      
      showToast("Payment recorded successfully", "success");
      setPaymentAmount("");
      
      // Refresh Data
      handleRowClick(selectedSupplier);
      fetchLedger();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsPaying(false);
    }
  };

  // --- STYLES ---
  const containerStyle = { padding: "30px", maxWidth: "1200px", margin: "0 auto", fontFamily: "'Inter', sans-serif" };
  const cardStyle = { background: "#fff", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", overflow: "hidden" };
  const headerStyle = { padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" };
  const thStyle = { padding: "16px 24px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "#64748B", textTransform: "uppercase", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" };
  const tdStyle = { padding: "16px 24px", fontSize: "14px", color: "#1E293B", borderBottom: "1px solid #E2E8F0" };
  const primaryBtnStyle = { background: "#1565C0", color: "white", padding: "10px 20px", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" };
  const inputStyle = { padding: "10px", borderRadius: "6px", border: "1px solid #D0D5DD", fontSize: "14px" };

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#F1F5F9" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Header />
        
        {toast.show && <ToastMessage message={toast.message} type={toast.type} onClose={() => setToast({ show: false })} />}

        <div style={containerStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <div>
              <h2 style={{ margin: 0, color: "#1E293B", fontSize: "24px", fontWeight: "700" }}>Supplier Ledger</h2>
              <p style={{ margin: "4px 0 0 0", color: "#64748B", fontSize: "14px" }}>Track supplier balances, invoices, and payments</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
            {/* Left Side: Supplier List */}
            <div style={{ ...cardStyle, flex: selectedSupplier ? 1 : '1 1 100%', transition: "all 0.3s" }}>
              <div style={headerStyle}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#1E293B" }}>All Suppliers</h3>
              </div>
              {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>Loading ledger...</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Supplier Name</th>
                      <th style={thStyle}>Total Purchases</th>
                      <th style={thStyle}>Total Paid</th>
                      <th style={thStyle}>Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map(sup => {
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
                          <td style={{ ...tdStyle, fontWeight: "700", color: balance > 0 ? "#DC2626" : "#16A34A" }}>
                            {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                    {suppliers.length === 0 && (
                      <tr>
                        <td colSpan="4" style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>No suppliers found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Right Side: Supplier Details & History */}
            {selectedSupplier && (
              <div style={{ ...cardStyle, flex: 1, position: "sticky", top: "24px" }}>
                <div style={headerStyle}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", color: "#1E293B" }}>{selectedSupplier.sup_name}</h3>
                    <p style={{ margin: "4px 0 0 0", color: "#64748B", fontSize: "13px" }}>
                      Current Balance: <strong style={{ color: Number(selectedSupplier.balance_due) > 0 ? "#DC2626" : "#16A34A" }}>LKR {Number(suppliers.find(s => s.sup_id === selectedSupplier.sup_id)?.balance_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                    </p>
                  </div>
                  <button onClick={() => setSelectedSupplier(null)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94A3B8" }}>×</button>
                </div>
                
                <div style={{ padding: "24px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#334155" }}>Make a Payment</h4>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <input 
                      type="number" 
                      style={{ ...inputStyle, flex: 1 }} 
                      placeholder="Amount (LKR)"
                      value={paymentAmount}
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
                      style={{ ...primaryBtnStyle, opacity: isPaying ? 0.7 : 1 }}
                      onClick={handleMakePayment}
                      disabled={isPaying}
                    >
                      {isPaying ? "Processing..." : "Pay Now"}
                    </button>
                  </div>
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
    </div>
  );
};

export default SupplierLedger;
