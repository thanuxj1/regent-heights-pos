import React, { useState, useEffect } from "react";

const SupplierDetailView = ({ supplier, onBack }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  // 1. COMPONENT GUARD: Prevent rendering if supplier is missing
  if (!supplier) {
    return <div style={{ padding: "20px" }}>No supplier selected.</div>;
  }

  const fetchOrderData = async () => {
    // 2. LOGIC GUARD: Prevent API calls if sup_id isn't available
    if (!supplier?.sup_id) return;

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      
      const poRes = await fetch(`/api/purchase-orders/supplier/${supplier.sup_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const poList = await poRes.json();
      const actualPOList = Array.isArray(poList) ? poList : poList.data || [];

      const payRes = await fetch(`/api/supplier-payments/supplier/${supplier.sup_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payData = await payRes.json();
      const payments = Array.isArray(payData) ? payData : payData.data || [];

      const mergedData = await Promise.all(actualPOList.map(async (po) => {
        const itemRes = await fetch(`/api/purchase-items/order/${po.po_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const itemData = await itemRes.json();
        
        return { 
          ...po, 
          items: Array.isArray(itemData) ? itemData : itemData.data || [],
          payment: payments.find(p => p.po_id === po.po_id) 
        };
      }));

      setOrders(mergedData);
    } catch (err) {
      console.error("Error loading history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderData();
  }, [supplier?.sup_id]); // Use optional chaining in dependency array

  const onMarkAsReceived = async (order) => {
    const method = window.prompt("Enter Payment Method (cash/card/cheque):", "cash");
    if (!method) return;

    setProcessingId(order.po_id);
    try {
      const token = localStorage.getItem("token");

      await fetch(`/api/purchase-orders/${order.po_id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: 'received' })
      });

      const totalAmount = order.items.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);
      await fetch(`/api/supplier-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          sup_id: supplier.sup_id,
          po_id: order.po_id,
          amount: totalAmount,
          method: method.toLowerCase(),
          payment_date: new Date().toISOString()
        })
      });

      await fetchOrderData();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: "20px", background: "none", border: "none", color: "#1565C0", fontWeight: "600", cursor: "pointer" }}>
        ← Back to Directory
      </button>

      <div style={{ background: "#fff", padding: "24px", borderRadius: "12px", border: "1px solid #E4E7EC", marginBottom: "24px" }}>
        <h2 style={{ margin: 0 }}>{supplier.sup_name}</h2>
        <p style={{ color: "#667085" }}>{supplier.sup_email} | {supplier.sup_contact}</p>
      </div>

      {loading ? <p>Loading history...</p> : orders.map((order) => (
        <div key={order.po_id} style={{ background: "#fff", borderRadius: "12px", border: "1px solid #EAECF0", marginBottom: "20px", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", background: "#F9FAFB", display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>Order #{order.po_id}</strong>
              <div style={{ fontSize: "12px", color: "#667085" }}>{new Date(order.order_date).toLocaleDateString()}</div>
            </div>
            <div>
              {order.status === "pending" ? (
                <button 
                  onClick={() => onMarkAsReceived(order)}
                  disabled={processingId === order.po_id}
                  style={{ padding: "6px 12px", background: "#1565C0", color: "#fff", border: "none", borderRadius: "6px" }}
                >
                  {processingId === order.po_id ? "Processing..." : "Mark as Received"}
                </button>
              ) : (
                <div style={{ textAlign: "right" }}>
                  <span style={{ padding: "4px 8px", background: "#ECFDF3", color: "#027A48", borderRadius: "6px", fontSize: "12px" }}>RECEIVED</span>
                  {order.payment && <div style={{ fontSize: "10px", marginTop: "4px" }}>Via {order.payment.method}</div>}
                </div>
              )}
            </div>
          </div>
          <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
            <tbody>
              {order.items.map((item, i) => (
                <tr key={i} style={{ borderTop: "1px solid #F2F4F7" }}>
                  <td style={{ padding: "10px 24px" }}>{item.rm_name}</td>
                  <td style={{ padding: "10px 24px" }}>{item.qty} {item.unit}</td>
                  <td style={{ padding: "10px 24px", textAlign: "right" }}>LKR {item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default SupplierDetailView;


// import React, { useState, useEffect } from "react";
