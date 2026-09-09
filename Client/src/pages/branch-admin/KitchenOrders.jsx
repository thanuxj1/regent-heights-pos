import React, { useEffect, useMemo, useState } from "react";
import { FaSync, FaSearch } from "react-icons/fa";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import { useAuth } from "../../context/AuthContext";
import { getOrders, getOrderItems, getBranchProducts } from "../../services/api";
import { connectSocket } from "../../services/socket";

const STATUS_BADGE = {
  pending:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  preparing: "bg-orange-100 text-orange-700 border-orange-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const KITCHEN_STATUSES = ["pending", "preparing", "completed"];

export default function KitchenOrders() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [orders, setOrders] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = branchId ? { b_id: branchId } : {};
      const [ordersData, itemsData, productsData] = await Promise.allSettled([
        getOrders(params),
        getOrderItems(params),
        branchId ? getBranchProducts(branchId) : getBranchProducts(),
      ]);
      if (ordersData.status === "fulfilled") {
        setOrders(Array.isArray(ordersData.value) ? ordersData.value : []);
      }
      if (itemsData.status === "fulfilled") {
        setOrderItems(Array.isArray(itemsData.value) ? itemsData.value : []);
      }
      if (productsData.status === "fulfilled") {
        setProducts(Array.isArray(productsData.value) ? productsData.value : []);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(false);
    const socket = connectSocket();
    let timer = null;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadData(true), 800);
    };
    socket.on("order:new", scheduleRefresh);
    socket.on("order:updated", scheduleRefresh);
    return () => {
      socket.off("order:new", scheduleRefresh);
      socket.off("order:updated", scheduleRefresh);
      clearTimeout(timer);
    };
  }, [branchId]);

  const productMap = useMemo(() =>
    products.reduce((acc, p) => { acc[p.Bpro_id] = p; return acc; }, {}),
  [products]);

  const itemsByOrder = useMemo(() => {
    return orderItems.reduce((acc, item) => {
      const product = productMap[item.Bpro_id];
      const stations = product?.stations || {};
      if (stations.Kitchen === false) return acc;
      if (stations.Bar === true && stations.Kitchen !== true) return acc;
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push({ ...item, product });
      return acc;
    }, {});
  }, [orderItems, productMap]);

  const kitchenOrders = useMemo(() => {
    return orders.filter((o) => {
      const items = itemsByOrder[o.or_id] || [];
      if (items.length === 0) return false;
      if (!KITCHEN_STATUSES.includes(o.or_status)) return false;
      if (statusFilter !== "all" && o.or_status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (String(o.or_id).includes(q)) return true;
        return items.some((i) => (i.product?.pro_name || "").toLowerCase().includes(q));
      }
      return true;
    });
  }, [orders, itemsByOrder, statusFilter, search]);

  const counts = useMemo(() => ({
    pending:   orders.filter((o) => itemsByOrder[o.or_id]?.length && o.or_status === "pending").length,
    preparing: orders.filter((o) => itemsByOrder[o.or_id]?.length && o.or_status === "preparing").length,
    completed: orders.filter((o) => itemsByOrder[o.or_id]?.length && o.or_status === "completed").length,
  }), [orders, itemsByOrder]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Header title="Kitchen Orders" />
        <main style={{ flex: 1, padding: "24px", overflowY: "auto" }}>

          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Pending",   key: "pending",   bg: "#FEF9C3", accent: "#B45309", border: "#FDE68A" },
              { label: "Preparing", key: "preparing", bg: "#FFEDD5", accent: "#C2410C", border: "#FED7AA" },
              { label: "Completed", key: "completed", bg: "#D1FAE5", accent: "#065F46", border: "#6EE7B7" },
            ].map((c) => (
              <div key={c.key} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: c.accent, margin: "6px 0" }}>{counts[c.key]}</div>
                <div style={{ fontSize: 12, color: "#94A3B8" }}>kitchen orders</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px" }}>
              <FaSearch style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontSize: 13 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by order ID or item name..."
                style={{ width: "100%", paddingLeft: 34, paddingRight: 12, paddingTop: 9, paddingBottom: 9, border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, outline: "none", background: "#fff", boxSizing: "border-box" }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "9px 14px", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, background: "#fff", cursor: "pointer" }}
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="preparing">Preparing</option>
              <option value="completed">Completed</option>
            </select>
            <button
              onClick={() => loadData(false)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              <FaSync size={12} /> Refresh
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>Loading kitchen orders...</div>
          ) : kitchenOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8" }}>No kitchen orders found.</div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                    {["Order ID", "Type", "Table", "Time", "Status", "Kitchen Items"].map((h) => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#64748B", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kitchenOrders.map((order, idx) => {
                    const items = itemsByOrder[order.or_id] || [];
                    const badge = STATUS_BADGE[order.or_status] || STATUS_BADGE.pending;
                    return (
                      <tr key={order.or_id} style={{ borderBottom: idx < kitchenOrders.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                        <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>
                          #{String(order.or_id).padStart(5, "0")}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#475569", textTransform: "capitalize" }}>
                          {order.or_type || "dine-in"}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#475569" }}>
                          {order.table_id ? `Table ${order.table_id}` : "—"}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#475569" }}>
                          {order.or_time?.slice(0, 5) || "—"}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "1px solid", textTransform: "capitalize" }} className={badge}>
                            {order.or_status}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {items.map((item) => (
                              <div key={item.orderItem_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {item.product?.pro_image ? (
                                  <img src={item.product.pro_image} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: 28, height: 28, borderRadius: 6, background: "#F1F5F9", flexShrink: 0 }} />
                                )}
                                <span style={{ color: "#334155" }}>
                                  {item.product?.pro_name || `Item ${item.Bpro_id}`}
                                  <span style={{ color: "#94A3B8", marginLeft: 6 }}>× {item.pro_quantity ?? 1}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
