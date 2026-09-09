import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBed,
  FaDesktop,
  FaMinus,
  FaPlus,
  FaSearch,
  FaShoppingCart,
  FaSignOutAlt,
  FaStore,
  FaTrashAlt,
  FaUtensils,
  FaUserCircle,
  FaWineGlassAlt,
  FaClipboardList,
  FaCoffee,
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import ToastMessage from "../../components/branch-admin/ToastMessage";
import { connectSocket } from "../../services/socket";
import { withRetry, isTransient } from "../../utils/retryRequest";
import Header from "../../components/branch-admin/Header";
import {
  getWaiterProfile,
  getBranchProducts,
  createWaiterOrder,
  createOrderItem,
  getCategories,
  getOrders,
} from "../../services/api";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const IMAGE_BASE_URL = API_BASE_URL.replace(/\/api\/?$/i, "");

const resolveProductImage = (value) => {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === "n/a") return "";
  if (/^data:/i.test(trimmed)) return trimmed;
  if (/^(https?:)?\/\//i.test(trimmed)) return trimmed;
  return `${IMAGE_BASE_URL}/images/${trimmed.replace(/^\/+/, "")}`;
};

const getCategoryIcon = (name) => {
  const lower = String(name).toLowerCase();
  if (lower.includes("bev") || lower.includes("drink") || lower.includes("bar") || lower.includes("wine")) {
    return FaWineGlassAlt;
  }
  if (lower.includes("dessert") || lower.includes("sweet") || lower.includes("cake") || lower.includes("coffee")) {
    return FaCoffee;
  }
  if (lower.includes("room")) {
    return FaBed;
  }
  if (lower.includes("desk")) {
    return FaDesktop;
  }
  return FaUtensils;
};

const WaiterPos = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  const [branchName, setBranchName] = useState("Loading...");
  const [branchId, setBranchId] = useState(null);
  const [roleName, setRoleName] = useState("Waiter");
  const [cartCollapsed, setCartCollapsed] = useState(false);
  const [products, setProducts] = useState([]);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categories, setCategories] = useState([
    { cat_id: "all", cat_name: "All Items" }
  ]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [readyToasts, setReadyToasts] = useState([]);

  const [activeView, setActiveView] = useState("menu"); // "menu" | "kitchen"
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenLoading, setKitchenLoading] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
  };

  const loadKitchenOrders = async (silent = false) => {
    if (!user?.u_id) return;
    if (!silent) setKitchenLoading(true);
    try {
      const data = await getOrders({ u_id: user.u_id });
      const relevant = (Array.isArray(data) ? data : []).filter((o) =>
        ["pending", "preparing", "completed"].includes(o.or_status)
      );
      setKitchenOrders(relevant.sort((a, b) => b.or_id - a.or_id));
    } catch (_) { /* silent */ } finally {
      if (!silent) setKitchenLoading(false);
    }
  };

  // Load kitchen orders when the tab becomes active
  useEffect(() => {
    if (activeView === "kitchen") loadKitchenOrders(false);
  }, [activeView, user?.u_id]);

  // Socket: kitchen ready toasts + live kitchen status refresh
  useEffect(() => {
    const socket = connectSocket();

    const handleReady = (order) => {
      const orderId = order?.or_id ?? order?.orderId;
      const label = orderId ? `#${String(orderId).padStart(5, "0")}` : "";
      const id = Date.now();
      setReadyToasts((prev) => [
        ...prev,
        { id, message: `Order ${label} is ready to serve!` },
      ]);
      setTimeout(() => setReadyToasts((prev) => prev.filter((t) => t.id !== id)), 7000);
      loadKitchenOrders(true);
    };

    const handleUpdated = () => loadKitchenOrders(true);

    socket.on("order:ready", handleReady);
    socket.on("order:updated", handleUpdated);
    return () => {
      socket.off("order:ready", handleReady);
      socket.off("order:updated", handleUpdated);
    };
  }, [user?.u_id]);

  const loadData = async () => {
    setLoading(true);
    setError("");

    // Categories don't depend on the profile, so they are fetched alongside it
    // rather than behind it — a hiccup on one no longer blanks the other.
    const [profileResult, catsResult] = await Promise.allSettled([
      withRetry(() => getWaiterProfile()),
      withRetry(() => getCategories()),
    ]);

    if (catsResult.status === "fulfilled" && catsResult.value) {
      setCategories([{ cat_id: "all", cat_name: "All Items" }, ...catsResult.value]);
    }

    if (profileResult.status === "rejected") {
      const err = profileResult.reason;
      console.error("Error loading POS data:", err);
      setError(
        isTransient(err)
          ? "Can't reach the server. Check the connection — this page will keep working once it's back."
          : "Failed to load data. Please refresh or contact admin.",
      );
      setLoading(false);
      return;
    }

    try {
      const profileData = profileResult.value?.data ?? null;

      if (!profileData) {
        setProducts([]);
        setLoading(false);
        return;
      }

      const resolvedBranchId =
        profileData.branch_id ?? profileData.b_id ?? profileData.B_id ?? null;

      setBranchId(resolvedBranchId);
      setBranchName(profileData.b_name || "Assigned Branch");
      if (profileData.role_name) setRoleName(profileData.role_name);

      if (!resolvedBranchId) {
        setProducts([]);
        setError("No branch is assigned to your account.");
        return;
      }

      const branchProductList = await withRetry(() => getBranchProducts(resolvedBranchId));
      setProducts(Array.isArray(branchProductList) ? branchProductList : []);
    } catch (err) {
      console.error("Error loading POS data:", err);
      setError(
        isTransient(err)
          ? "Can't reach the server. Check the connection — this page will keep working once it's back."
          : "Failed to load data. Please refresh or contact admin.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.u_id]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return products.filter((product) => {
      const name = String(product.pro_name ?? "").toLowerCase();
      const description = String(product.pro_des ?? "").toLowerCase();
      const shortName = String(product.pro_shortname ?? "").toLowerCase();

      const matchesSearch =
        !term || [name, description, shortName].some((value) => value.includes(term));

      const matchesCategory =
        selectedCategoryId === "all" || Number(product.cat_id) === Number(selectedCategoryId);

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategoryId]);

  const taxableBase = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }, [cart]);

  const itemTaxTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty * ((item.taxGroup ?? 5) / 100), 0);
  }, [cart]);

  const effectiveTaxRate = taxableBase > 0 ? (itemTaxTotal / taxableBase) * 100 : 5;
  const taxAmount = itemTaxTotal;
  const total = taxableBase + taxAmount;

  const addToCart = (product) => {
    const stockCount = Number(product.pro_quantity ?? 0);
    const basePrice = Number(product.pro_price ?? 0);
    const discPct = Number(product.discount_pct ?? 0);
    const effectivePrice = discPct > 0
      ? parseFloat((basePrice * (1 - discPct / 100)).toFixed(2))
      : basePrice;
    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.Bpro_id === product.Bpro_id);
      if (existing) {
        if (existing.qty >= stockCount) {
          showToast(`Cannot add more. Only ${stockCount} items available in stock.`, "error");
          return currentCart;
        }
        return currentCart.map((item) =>
          item.Bpro_id === product.Bpro_id
            ? { ...item, qty: item.qty + 1 }
            : item
        );
      }

      if (stockCount <= 0) {
        showToast("This item is out of stock.", "error");
        return currentCart;
      }

      return [
        ...currentCart,
        {
          Bpro_id: product.Bpro_id,
          pro_name: product.pro_name,
          unitPrice: effectivePrice,
          originalPrice: discPct > 0 ? basePrice : null,
          discountPct: discPct,
          taxGroup: Number(product.tax_group ?? 5),
          qty: 1,
        },
      ];
    });
  };

  const updateQuantity = (Bpro_id, delta) => {
    const product = products.find((p) => p.Bpro_id === Bpro_id);
    const stockCount = Number(product?.pro_quantity ?? 0);

    setCart((currentCart) =>
      currentCart
        .map((item) => {
          if (item.Bpro_id === Bpro_id) {
            const nextQty = item.qty + delta;
            if (delta > 0 && nextQty > stockCount) {
              showToast(`Cannot add more. Only ${stockCount} items available in stock.`, "error");
              return item;
            }
            return { ...item, qty: nextQty };
          }
          return item;
        })
        .filter((item) => item.qty > 0)
    );
  };

  const removeFromCart = (Bpro_id) => {
    setCart((currentCart) => currentCart.filter((item) => item.Bpro_id !== Bpro_id));
  };

  const handlePlaceOrder = async () => {
    if (!cart.length) return;
    try {
      setSubmitting(true);
      setError("");

      // Create main waiter order
      const orderPayload = {
        or_tax: Number(effectiveTaxRate.toFixed(4)),
        or_totalcost: Number(taxableBase.toFixed(2)),
        or_totalCostWtax: Number(total.toFixed(2)),
      };

      const orderRes = await createWaiterOrder(orderPayload);
      if (!orderRes.success) throw new Error(orderRes.error || "Failed to create order");
      
      const orderId = orderRes.data.or_id || orderRes.data.order_id || orderRes.data.id; 

      if (!orderId) {
        throw new Error("Created order ID is missing");
      }

      // Add order items
      await Promise.all(
        cart.map((item) =>
          createOrderItem({
            Bpro_id: item.Bpro_id,
            pro_quantity: item.qty,
            unit_price: item.unitPrice,
            order_id: orderId,
          })
        )
      );

      setCart([]);
      showToast("Order placed successfully!", "success");
      
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to place order.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#55C24A]"></div>
          <p className="font-medium text-slate-600">Loading Waiter System...</p>
        </div>
      </div>
    );
  }

  
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-800">
        {toast.show && (
          <ToastMessage
            message={toast.message}
            type={toast.type}
            onClose={() => setToast((current) => ({ ...current, show: false }))}
          />
        )}

        {/* Kitchen ready notifications — stacked bottom-right */}
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
          {readyToasts.map((t) => (
            <div key={t.id} style={{
              background: "#065F46",
              color: "#fff",
              padding: "14px 20px",
              borderRadius: 12,
              boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
              fontSize: 14,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 260,
              animation: "slideIn 0.3s ease",
            }}>
              <span style={{ fontSize: 20 }}>🍽️</span>
              <span>{t.message.replace(" 🍽️", "")}</span>
              <button onClick={() => setReadyToasts((p) => p.filter((x) => x.id !== t.id))}
                style={{ marginLeft: "auto", background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>

        {/* The same header the till uses, so the two screens read as one
            system. The profile and logout ride in its actions slot — a waiter
            works a shared tablet and needs to see whose session is open. */}
        <Header
          title="Waiter POS"
          actions={
            <>
              <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/15 px-2.5 py-1.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#0A5BAE]">
                  <FaUserCircle className="h-4 w-4" />
                </div>
                <div className="hidden text-left sm:block">
                  <div className="text-[11px] font-semibold leading-none">
                    {user?.u_fname || "Waiter"} {user?.u_lname || ""}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-none text-white/80">
                    {roleName} • {branchName}
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/50"
              >
                <FaSignOutAlt className="h-3 w-3" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </>
          }
        />

        {/* Main Workspace: menu on the left, order on the right */}
        <div className="flex flex-1 overflow-hidden">

        {/* Brings the order back when it has been folded away. Carries the
            count so a waiter can see there is an order in progress. */}
        {cartCollapsed && (
          <button
            type="button"
            onClick={() => setCartCollapsed(false)}
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-[#0A5BAE] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#094f96]"
          >
            <FaClipboardList className="h-4 w-4" />
            Order
            {cart.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-[#0A5BAE]">
                {cart.reduce((n, i) => n + i.qty, 0)}
              </span>
            )}
          </button>
        )}

          <main className="flex flex-1 flex-col overflow-hidden">

        {/* Topbar — tabs + categories/search */}
        <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm lg:px-8">

          <div className="flex flex-wrap items-center justify-between gap-3">
          {/* View tabs */}
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setActiveView("menu")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                activeView === "menu"
                  ? "bg-white text-[#0A5BAE] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <FaStore className="h-3.5 w-3.5" /> Menu
            </button>
            <button
              onClick={() => setActiveView("kitchen")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                activeView === "kitchen"
                  ? "bg-white text-[#0A5BAE] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <FaUtensils className="h-3.5 w-3.5" /> Kitchen Status
              {kitchenOrders.filter((o) => o.or_status === "completed").length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                  {kitchenOrders.filter((o) => o.or_status === "completed").length}
                </span>
              )}
            </button>
          </div>

          {activeView === "menu" ? (
              /* Category as a filter, not a row of chips: the same choice in a
                 fraction of the height, which matters on a tablet. */
              <div className="flex flex-1 items-center justify-end gap-2">
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  aria-label="Filter by category"
                  className="h-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#0A5BAE] focus:bg-white"
                >
                  {categories.map((cat) => (
                    <option key={cat.cat_id} value={cat.cat_id}>
                      {cat.cat_id === "all" ? "All Items" : cat.cat_name}
                    </option>
                  ))}
                </select>

              <div className="relative flex min-w-[150px] max-w-[260px] flex-1 items-center">
                <FaSearch className="absolute left-4 z-10 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-4 text-sm outline-none transition-all focus:border-[#0A5BAE] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                />
              </div>
              </div>
          ) : (
            <div className="flex flex-1 items-center justify-between gap-3">
              <span className="hidden text-sm text-slate-500 sm:inline">Live kitchen status for your orders</span>
              <button
                onClick={() => loadKitchenOrders(false)}
                className="ml-auto flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200"
              >
                <FaSearch className="h-3 w-3" /> Refresh
              </button>
            </div>
          )}
          </div>

        </header>

        {/* Content Area: Menu or Kitchen Status */}
        {activeView === "menu" ? (
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <div className="mb-8 flex items-center justify-between">
              <h1 className="text-2xl font-black tracking-tight text-slate-800">
                {categories.find(c => String(c.cat_id) === String(selectedCategoryId))?.cat_name || "All Products"}
                <span className="ml-3 rounded-full bg-[#0A5BAE]/10 px-3 py-1 text-sm font-bold text-[#0A5BAE]">
                  {filteredProducts.length} Items
                </span>
              </h1>
            </div>

            {filteredProducts.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 pb-20 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {filteredProducts.map((p) => {
                  const basePrice = Number(p.pro_price ?? 0);
                  const discPct = Number(p.discount_pct ?? 0);
                  const effectivePrice = discPct > 0
                    ? parseFloat((basePrice * (1 - discPct / 100)).toFixed(2))
                    : basePrice;
                  const stockCount = Number(p.pro_quantity ?? 0);
                  const soldOut = stockCount <= 0;
                  const lowStock = stockCount > 0 && stockCount <= 5;
                  const photo = resolveProductImage(p.pro_image);

                  // Same guess as the till: icon and tint from the item's own
                  // name, so a plate of rice is not drawn as a coffee cup.
                  const { Icon, chip } = (() => {
                    const src = `${p.pro_name ?? ""} ${p.pro_des ?? ""}`.toLowerCase();
                    const has = (...w) => w.some((x) => src.includes(x));
                    if (has("coffee", "tea", "juice", "shake", "smoothie"))
                      return { Icon: FaCoffee, chip: "bg-amber-50 text-amber-500" };
                    if (has("beer", "wine", "whiskey", "cocktail", "arrack", "vodka", "gin"))
                      return { Icon: FaWineGlassAlt, chip: "bg-violet-50 text-violet-400" };
                    if (has("suite", "laundry", "parking", "checkout", "desk", "service"))
                      return { Icon: FaDesktop, chip: "bg-slate-100 text-slate-400" };
                    return { Icon: FaUtensils, chip: "bg-orange-50 text-orange-400" };
                  })();

                  return (
                    <div
                      key={p.Bpro_id}
                      onClick={() => (soldOut ? undefined : addToCart(p))}
                      title={soldOut ? `${p.pro_name} — out of stock` : `Add ${p.pro_name}`}
                      className={`group relative flex flex-col rounded-xl border bg-white p-2 transition duration-200 ${
                        soldOut
                          ? "cursor-not-allowed border-slate-200 opacity-60"
                          : "cursor-pointer border-slate-100 shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)]"
                      }`}
                    >
                      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-slate-50">
                        {photo ? (
                          <img
                            src={photo}
                            alt=""
                            className={`h-full w-full object-cover transition duration-300 ${soldOut ? "grayscale" : "group-hover:scale-105"}`}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        ) : (
                          <span className={`flex h-full w-full items-center justify-center transition duration-300 ${soldOut ? "bg-slate-100 text-slate-300" : `${chip} group-hover:scale-105`}`}>
                            <Icon className="h-6 w-6" />
                          </span>
                        )}

                        {discPct > 0 && !soldOut && (
                          <span className="absolute left-1 top-1 rounded bg-rose-500 px-1 py-px text-[9px] font-bold text-white shadow-sm">
                            -{discPct}%
                          </span>
                        )}

                        <span
                          className={`absolute right-1 top-1 rounded-full px-1.5 py-px text-[9px] font-semibold shadow-sm ${
                            soldOut
                              ? "bg-slate-600 text-white"
                              : lowStock
                                ? "bg-amber-400 text-amber-950"
                                : "bg-white/90 text-slate-600"
                          }`}
                        >
                          {soldOut ? "Sold out" : `${stockCount} left`}
                        </span>

                        {!soldOut && (
                          <span className="pointer-events-none absolute bottom-1 right-1 flex h-6 w-6 translate-y-1 items-center justify-center rounded-full bg-[#0A5BAE] text-white opacity-0 shadow-md transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                            <FaPlus className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>

                      <h3
                        className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900"
                        title={p.pro_name}
                      >
                        {p.pro_name}
                      </h3>

                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-[13.5px] font-bold text-slate-800">
                          LKR {effectivePrice.toFixed(2)}
                        </span>
                        {discPct > 0 && (
                          <span className="text-[11px] text-slate-400 line-through">
                            {basePrice.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-[400px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white/50">
                <div className="mb-4 rounded-full bg-slate-100 p-6 text-slate-300">
                  <FaStore className="h-12 w-12" />
                </div>
                <p className="text-lg font-bold text-slate-500">No products found</p>
                <p className="mt-1 text-sm text-slate-400">
                  Try adjusting your search or category filter.
                </p>
              </div>
            )}
          </div>
        ) : (
          /* ── Kitchen Status View ── */
          <div className="flex-1 overflow-y-auto p-6">
            {kitchenLoading ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#0A5BAE]" />
              </div>
            ) : kitchenOrders.length === 0 ? (
              <div className="flex h-[400px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white/50">
                <div className="mb-4 rounded-full bg-slate-100 p-6 text-slate-300">
                  <FaUtensils className="h-12 w-12" />
                </div>
                <p className="text-lg font-bold text-slate-500">No active orders</p>
                <p className="mt-1 text-sm text-slate-400">Place an order from the Menu tab.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {kitchenOrders.map((order) => {
                  const statusConfig = {
                    pending:   { label: "Waiting",   bg: "bg-amber-50",   border: "border-amber-200",  badge: "bg-amber-100 text-amber-700",   dot: "bg-amber-400" },
                    preparing: { label: "Preparing", bg: "bg-orange-50",  border: "border-orange-200", badge: "bg-orange-100 text-orange-700", dot: "bg-orange-400" },
                    completed: { label: "Ready! 🍽️", bg: "bg-emerald-50", border: "border-emerald-300",badge: "bg-emerald-100 text-emerald-700",dot: "bg-emerald-500" },
                  }[order.or_status] ?? { label: order.or_status, bg: "bg-slate-50", border: "border-slate-200", badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };

                  return (
                    <div
                      key={order.or_id}
                      className={`rounded-2xl border-2 ${statusConfig.border} ${statusConfig.bg} p-5 shadow-sm transition-all ${order.or_status === "completed" ? "ring-2 ring-emerald-300 ring-offset-2" : ""}`}
                    >
                      {/* Order header */}
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <div className="text-base font-black text-slate-800">
                            Order #{String(order.or_id).padStart(5, "0")}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {order.table_id
                              ? `Table ${order.table_id}`
                              : order.or_type === "dine-in"
                                ? "Dine-in"
                                : "Takeaway"} · {order.or_time?.slice(0, 5) || "--:--"}
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${statusConfig.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
                          {statusConfig.label}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            order.or_status === "pending"   ? "w-1/3 bg-amber-400" :
                            order.or_status === "preparing" ? "w-2/3 bg-orange-400" :
                            "w-full bg-emerald-500"
                          }`}
                        />
                      </div>

                      {/* Total */}
                      <div className="text-right text-sm font-semibold text-slate-600">
                        LKR {Number(order["or_totalCostWtax"] ?? order.or_totalcost ?? 0).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Cart Sidebar */}
      <aside
        className={`flex flex-col border-l border-slate-200 bg-white shrink-0 transition-[width] duration-200 ${
          cartCollapsed ? "w-0 overflow-hidden border-l-0" : "w-full sm:w-[300px] md:w-[330px] lg:w-[380px]"
        }`}
      >
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-slate-100 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-800">Order Summary</h2>
            {/* Was a decorative div. On a tablet the order panel eats the menu,
                so it now folds the panel away and gives the menu the screen. */}
            <button
              type="button"
              onClick={() => setCartCollapsed(true)}
              title="Hide the order and show the whole menu"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-[#0A5BAE] hover:text-white"
            >
              <FaClipboardList className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cart Listing */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center opacity-60">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
                <FaShoppingCart className="h-8 w-8 text-slate-400" />
              </div>
              <p className="text-sm font-bold text-slate-600">Order is empty</p>
              <p className="mt-1 text-xs text-slate-400">
                Add products from the menu to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((item) => (
                <div
                  key={item.Bpro_id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h4 className="line-clamp-2 text-sm font-bold leading-snug text-slate-800">
                        {item.pro_name}
                      </h4>
                      <p className="mt-1 text-sm font-black text-[#0A5BAE]">
                        LKR {item.unitPrice.toFixed(2)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.Bpro_id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-500 hover:text-white"
                    >
                      <FaTrashAlt className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                    <p className="text-sm font-bold text-slate-700">
                      LKR {(item.unitPrice * item.qty).toFixed(2)}
                    </p>
                    <div className="flex items-center gap-3 rounded-full bg-slate-100 p-1">
                      <button
                        onClick={() => updateQuantity(item.Bpro_id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm transition-hover hover:bg-slate-200"
                      >
                        <FaMinus className="h-3 w-3" />
                      </button>
                      <span className="w-4 text-center text-sm font-bold tabular-nums text-slate-800">
                        {item.qty}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.Bpro_id, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0A5BAE] text-white shadow-sm transition-hover hover:bg-[#094f96]"
                      >
                        <FaPlus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Math & Checkout */}
        <div className="border-t border-slate-200 bg-white p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.03)] z-10">
          <div className="space-y-3 border-b border-slate-100 pb-5 text-sm">
            <div className="flex justify-between">
              <span className="font-semibold text-slate-500">Subtotal</span>
              <span className="font-bold text-slate-800 tabular-nums">
                LKR {taxableBase.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[#0A5BAE]">
              <span className="font-semibold">Tax ({effectiveTaxRate.toFixed(1)}%)</span>
              <span className="font-bold tabular-nums">LKR {taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-slate-500">Items/Qty</span>
              <span className="font-bold text-slate-800 tabular-nums">
                {cart.length} / {cart.reduce((s, i) => s + i.qty, 0)}
              </span>
            </div>
          </div>

          <div className="flex items-end justify-between py-5">
            <span className="text-sm font-black uppercase tracking-wider text-slate-400">
              Total
            </span>
            <span className="text-3xl font-black tracking-tight text-slate-800 tabular-nums">
              LKR {total.toFixed(2)}
            </span>
          </div>

          <button
            onClick={handlePlaceOrder}
            disabled={submitting || cart.length === 0}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#55C24A] px-6 py-4 text-base font-bold text-white shadow-[0_8px_24px_rgba(85,194,74,0.25)] transition-all hover:bg-[#49b03f] hover:shadow-[0_12px_32px_rgba(85,194,74,0.35)] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
          >
            <FaShoppingCart className="h-5 w-5" />
            {submitting ? "Placing Order..." : "Send to Kitchen"}
          </button>
        </div>
      </aside>
        </div>
      </div>
    );
};

export default WaiterPos;