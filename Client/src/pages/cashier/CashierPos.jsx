import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBed,
  FaCalculator,
  FaCoffee,
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
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import {
  createOrder,
  createOrderWithItems,
  getCashSession,
  createOrderItem,
  getBranchById,
  getBranchProducts,
  getCategories,
  getRoomGrid,
  createRoomServiceOrder,
  getOrders,
  getOrderItemsByOrderId,
  updateOrderStatus,
  updateOrder,
  deleteOrderItem,
} from "../../services/api";
import { connectSocket } from "../../services/socket";
import { staleWhileRevalidate } from "../../services/localCache";
import {
  newClientRef, queueSale, isOffline, flushQueue, startAutoFlush,
  queuedCount, onQueueChange, parkedSales, clearParked, connected,
} from "../../services/offline";
import OrderReadyAlerts from "../../components/cashier/OrderReadyAlerts";
import CashDrawerModal from "../../components/cashier/CashDrawerModal";
import { printKot } from "../../utils/printKot";
import { withRetry, isTransient } from "../../utils/retryRequest";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import {
  addOrderReadyAlert,
  dismissOrderReadyAlert,
  loadOrderReadyAlerts,
  saveOrderReadyAlerts,
} from "../../utils/orderReadyAlerts";


const ALL_ITEMS = { cat_id: "all", cat_name: "All Items" };

// Mirrors DISCOUNT_APPROVAL_PCT on the server. Only decides when to ask for a
// PIN — the server refuses regardless of what this file says.
const DISCOUNT_LIMIT_PCT = 10;
/** Roles that are their own approval. */
const MANAGER_ROLES = [1, 2, 6];

const CashierPos = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  // A manager is already the approval — never ask them for a second signature.
  const isManager = MANAGER_ROLES.includes(Number(user?.role_id));
  const [branchName, setBranchName] = useState("");
  const [showOrderNotes, setShowOrderNotes] = useState(false);
  const [sentToKitchen, setSentToKitchen] = useState(false);
  const [branchId, setBranchId] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([ALL_ITEMS]);
  // Rooms with a guest actually in them, for charging food to the bill.
  const [occupiedRooms, setOccupiedRooms] = useState([]);
  const [chargeRoomId, setChargeRoomId] = useState("");
  const [successNote, setSuccessNote] = useState("");
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [roomQuery, setRoomQuery] = useState("");
  // The cart survives a reload. A till gets closed by accident, the browser
  // crashes, the network drops mid-sale — none of that should cost a cashier a
  // half-rung-up order with a customer standing there.
  const cartKey = `pos_cart_${user?.u_id ?? "guest"}`;
  const [cart, setCart] = useState(() => {
    try {
      const stored = localStorage.getItem(`pos_cart_${user?.u_id ?? "guest"}`);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [orderType, setOrderType] = useState("takeaway");
  const [allergies, setAllergies] = useState("");
  const [addons, setAddons] = useState("");
  const [notes, setNotes] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  // A big discount needs a manager's PIN. The server is the authority — this
  // number only decides when to ask, so a cashier who edits it still gets
  // turned away at the till.
  const approvalPinRef = useRef("");
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [serviceFee, setServiceFee] = useState(0);
  const [heldOrders, setHeldOrders] = useState(() => {
    try {
      const stored = localStorage.getItem(`held_orders_${user?.u_id ?? "guest"}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showHeldOrdersModal, setShowHeldOrdersModal] = useState(false);
  const [showHoldTableModal, setShowHoldTableModal] = useState(false);
  const [holdTableInput, setHoldTableInput] = useState("");
  const [pendingHoldData, setPendingHoldData] = useState(null);
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [editingOrderCurrentStatus, setEditingOrderCurrentStatus] = useState(null);
  const [editingOrderTableId, setEditingOrderTableId] = useState(null);

  // A cashier must be able to see, without asking anyone, whether the till is
  // talking to the server and whether anything is still waiting to go up.
  // `connected` is not navigator.onLine: the till can have wifi and still not
  // reach the server, which is the common case in a hotel.
  const [online, setOnline] = useState(() => connected());
  const [pending, setPending] = useState(() => ({ queued: queuedCount(), parked: parkedSales().length }));

  useEffect(() => {
    const up = () => setOnline(connected());
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const stopWatching = onQueueChange((p) => {
      setPending(p);
      if (typeof p.connected === "boolean") setOnline(p.connected);
    });
    // Anything left by the last session goes out as soon as there is a network.
    const stopFlushing = startAutoFlush((sale) => createOrderWithItems(sale));
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      stopWatching();
      stopFlushing();
    };
  }, []);

  const sendQueuedNow = async () => {
    const r = await flushQueue((sale) => createOrderWithItems(sale));
    setPending({ queued: queuedCount(), parked: parkedSales().length });
    if (r.sent) setSuccessNote(`${r.sent} offline sale${r.sent === 1 ? "" : "s"} sent.`);
    else if (r.remaining) setError("Still no connection — the sales are safe and will go up automatically.");
  };

  // The drawer. Checked on load so the till can prompt for a float rather than
  // letting an hour of cash sales pile up against no shift.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const refreshDrawer = useCallback(async () => {
    if (!branchId) return;
    try { setDrawer(await getCashSession(branchId)); } catch { /* till still works */ }
  }, [branchId]);

  useEffect(() => { refreshDrawer(); }, [refreshDrawer]);

  const [waiterOrders, setWaiterOrders] = useState([]);
  const [showWaiterOrdersModal, setShowWaiterOrdersModal] = useState(false);
  const [loadingWaiterOrders, setLoadingWaiterOrders] = useState(false);
  const [orderReadyAlerts, setOrderReadyAlerts] = useState([]);
  const [newWaiterToasts, setNewWaiterToasts] = useState([]);

  const fetchWaiterOrders = async () => {
    try {
      setLoadingWaiterOrders(true);
      const allOrders = await getOrders(branchId ? { b_id: branchId } : {});
      const activeDineIn = allOrders.filter(
        (o) =>
          o.or_type === "dine-in" &&
          o.or_status !== "cancelled" &&
          (!branchId || String(o.b_id) === String(branchId))
      );
      setWaiterOrders(activeDineIn);
    } catch (err) {
      console.error("Failed to fetch waiter orders", err);
    } finally {
      setLoadingWaiterOrders(false);
    }
  };

  const handleOpenWaiterOrders = () => {
    fetchWaiterOrders();
    setShowWaiterOrdersModal(true);
  };

  useEffect(() => {
    const loadPosData = async () => {
      try {
        setLoading(true);
        setError("");

        const branchId = user?.b_id ?? user?.B_id ?? null;

        if (!branchId) {
          setError("No branch is assigned to your account.");
          setLoading(false);
          return;
        }

        setBranchId(branchId);

        // The menu is shown from the till's own copy straight away and checked
        // against the server behind the scenes. Waiting on a round trip to Ohio
        // before drawing anything is what made opening the till feel slow.
        const cachedMenu = await staleWhileRevalidate(
          `menu_${branchId}`,
          () => withRetry(() => getBranchProducts(branchId)),
          (fresh) => setProducts(fresh),
        );
        const cachedCats = await staleWhileRevalidate(
          `categories_${branchId}`,
          () => withRetry(() => getCategories()),
          (fresh) => Array.isArray(fresh) && setCategories([ALL_ITEMS, ...fresh]),
        );

        if (cachedMenu.fromCache) {
          setProducts(cachedMenu.value);
          if (Array.isArray(cachedCats.value)) setCategories([ALL_ITEMS, ...cachedCats.value]);
          setLoading(false);   // the cashier can start ringing up now
        }

        // The name is only a label, and the room grid is never cached — a guest
        // may have checked out since. Neither should stop the till opening.
        const [branchResult, roomResult] = await Promise.allSettled([
          withRetry(() => getBranchById(branchId)),
          withRetry(() => getRoomGrid({ b_id: branchId })),
        ]);
        const productsResult = { status: "fulfilled", value: cachedMenu.value };
        const categoryResult = { status: "fulfilled", value: cachedCats.value };

        if (branchResult.status === "fulfilled") {
          const branch = branchResult.value;
          setBranchName(branch?.B_name ?? branch?.data?.B_name ?? "Selected branch");
        }

        if (productsResult.status === "rejected") throw productsResult.reason;
        setProducts(productsResult.value);

        // The menu's own categories, not a guess from the product name.
        if (categoryResult.status === "fulfilled" && Array.isArray(categoryResult.value)) {
          setCategories([ALL_ITEMS, ...categoryResult.value]);
        }
        // Only rooms with a checked-in guest can take a charge.
        if (roomResult.status === "fulfilled") {
          const grid = roomResult.value;
          const rooms = Array.isArray(grid) ? grid : (grid?.rooms ?? []);
          // Every room is kept. The picker greys out the ones that cannot take
          // a charge rather than hiding them: a cashier told "room 105" needs to
          // see that 105 exists and is empty, not wonder if they misheard.
          setOccupiedRooms(rooms);
        }
        // Load waiter orders count on mount so the button badge is live
        try {
          const allOrders = await getOrders({ b_id: branchId });
          const activeDineIn = allOrders.filter(
            (o) =>
              o.or_type === "dine-in" &&
              o.or_status !== "completed" &&
              o.or_status !== "cancelled" &&
              String(o.b_id) === String(branchId)
          );
          setWaiterOrders(activeDineIn);
        } catch { /* non-critical */ }

      } catch (loadError) {
        if (isTransient(loadError)) {
          setError("Can't reach the server. Check the connection — the till will work again once it's back.");
          setLoading(false);
          return;
        }
        setError(
          loadError?.response?.data?.message ||
          loadError.message ||
          "Failed to load POS data",
        );
      } finally {
        setLoading(false);
      }
    };

    loadPosData();
  }, [user?.b_id, user?.B_id]);

  useEffect(() => {
    if (!user?.u_id) {
      setOrderReadyAlerts([]);
      return;
    }

    setOrderReadyAlerts(loadOrderReadyAlerts(user.u_id));
  }, [user?.u_id]);

  useEffect(() => {
    if (!user?.u_id) return;
    try {
      localStorage.setItem(`held_orders_${user.u_id}`, JSON.stringify(heldOrders));
    } catch {}
  }, [heldOrders, user?.u_id]);

  // Written on every change rather than on unload: a crash or a killed tab
  // never reaches an unload handler.
  useEffect(() => {
    try {
      if (cart.length) localStorage.setItem(cartKey, JSON.stringify(cart));
      else localStorage.removeItem(cartKey);
    } catch {}
  }, [cart, cartKey]);

  useEffect(() => {
    const socket = connectSocket();

    const handleOrderReady = (order) => {
      if (!order) return;
      if (user?.u_id && order.u_id && Number(order.u_id) !== Number(user.u_id)) {
        return;
      }

      setOrderReadyAlerts((currentAlerts) => {
        const nextAlerts = addOrderReadyAlert(currentAlerts, order);
        saveOrderReadyAlerts(user?.u_id, nextAlerts);
        return nextAlerts;
      });
    };

    socket.on("order:ready", handleOrderReady);

    // Refresh waiter orders count badge and show toast when a new dine-in order arrives
    const handleNewOrder = (order) => {
      fetchWaiterOrders();
      if (order?.or_type === "dine-in") {
        const toast = { id: `wt-${order.or_id ?? Date.now()}`, orderId: order.or_id };
        setNewWaiterToasts((prev) => [...prev, toast]);
        setTimeout(() => {
          setNewWaiterToasts((prev) => prev.filter((t) => t.id !== toast.id));
        }, 6000);
      }
    };
    const refreshWaiterCount = () => fetchWaiterOrders();
    socket.on("order:new", handleNewOrder);
    socket.on("order:updated", refreshWaiterCount);

    return () => {
      socket.off("order:ready", handleOrderReady);
      socket.off("order:new", handleNewOrder);
      socket.off("order:updated", refreshWaiterCount);
    };
  }, [user?.u_id]);

  const handleDismissOrderReady = useCallback(
    (orderId) => {
      setOrderReadyAlerts((currentAlerts) => {
        const nextAlerts = dismissOrderReadyAlert(currentAlerts, orderId);
        saveOrderReadyAlerts(user?.u_id, nextAlerts);
        return nextAlerts;
      });
    },
    [user?.u_id],
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return products.filter((product) => {
      const name = String(product.pro_name ?? "").toLowerCase();
      const description = String(product.pro_des ?? "").toLowerCase();
      const shortName = String(product.pro_shortname ?? "").toLowerCase();

      const matchesSearch =
        !term || [name, description, shortName].some((value) => value.includes(term));

      const matchesCategory =
        selectedCategoryId === "all" ||
        Number(product.cat_id) === Number(selectedCategoryId);

      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategoryId]);

  /**
   * A room can take a charge only if someone is actually in it. `status` alone
   * is not enough: a checked-in booking whose guest record has gone leaves a
   * room reading "occupied" with nobody to bill, and the API refuses it.
   */
  const canCharge = (r) => r?.status === "occupied" && !!r?.guest_name;

  const inHouseCount = useMemo(
    () => occupiedRooms.filter(canCharge).length,
    [occupiedRooms],
  );

  const chargeRoom = useMemo(
    () => occupiedRooms.find((r) => String(r.room_id) === String(chargeRoomId)) || null,
    [occupiedRooms, chargeRoomId],
  );

  /** Room number or guest name — the caller gives one or the other. */
  const roomMatches = useMemo(() => {
    const q = roomQuery.trim().toLowerCase();
    if (!q) return occupiedRooms;
    return occupiedRooms.filter((r) =>
      `${r.room_number} ${r.guest_name ?? ""} ${r.type_name ?? ""}`.toLowerCase().includes(q),
    );
  }, [occupiedRooms, roomQuery]);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0),
    [cart],
  );
  const itemTaxTotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty * ((item.taxGroup ?? 5) / 100), 0),
    [cart],
  );
  const effectiveTaxRate = subtotal > 0 ? (itemTaxTotal / subtotal) * 100 : 0;

  const discountAmount = subtotal * (Number(discountPct || 0) / 100);
  const taxableBase = subtotal - discountAmount + Number(serviceFee || 0);
  const tax = taxableBase * (effectiveTaxRate / 100);
  const total = taxableBase + tax;


  const addToCart = (product) => {
    const basePrice = Number(product.pro_price ?? 0);
    const discPct = Number(product.discount_pct ?? 0);
    const unitPrice = discPct > 0
      ? parseFloat((basePrice * (1 - discPct / 100)).toFixed(2))
      : basePrice;

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.Bpro_id === product.Bpro_id);
      if (existing) {
        return currentCart.map((item) =>
          item.Bpro_id === product.Bpro_id
            ? { ...item, qty: item.qty + 1 }
            : item,
        );
      }

      return [
        ...currentCart,
        {
          Bpro_id: product.Bpro_id,
          pro_name: product.pro_name,
          unitPrice,
          originalPrice: discPct > 0 ? basePrice : null,
          discountPct: discPct,
          taxGroup: Number(product.tax_group ?? 5),
          qty: 1,
        },
      ];
    });
  };

  const updateQuantity = (Bpro_id, delta) => {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.Bpro_id === Bpro_id ? { ...item, qty: item.qty + delta } : item,
        )
        .filter((item) => item.qty > 0),
    );
  };

  const removeFromCart = (Bpro_id) => {
    setCart((currentCart) => currentCart.filter((item) => item.Bpro_id !== Bpro_id));
  };

  /**
   * Send the order to the kitchen and print the ticket.
   *
   * Created as `pending` so it lands in the kitchen's Pending column exactly
   * like a waiter's order — the kitchen accepts it, which moves it to
   * preparing. Money is settled afterwards; the cart is kept so the cashier
   * can still take payment on the same order.
   */
  const handleSendToKitchen = async () => {
    if (!cart.length || !user?.u_id) return;
    if (!branchId) {
      setError("No branch is assigned to this user.");
      return;
    }
    // The kitchen screen is fed over the network. A docket printed here while
    // the connection is down would never reach it, and the cashier would think
    // the food was on. Say so and let them use a paper docket.
    if (!online) {
      setError(
        "The kitchen screen cannot be reached while offline — send this order on paper. " +
        "You can still take the payment; the sale will go up when the connection returns.",
      );
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const orderResponse = await createOrder({
        or_tax: Number(effectiveTaxRate.toFixed(4)),
        or_totalcost: Number(taxableBase.toFixed(2)),
        or_totalCostWtax: Number(total.toFixed(2)),
        or_status: "pending",
        or_type: orderType,
        cust_id: null,
        u_id: user.u_id,
        b_id: branchId,
        table_id: null,
      });

      const orderId = orderResponse?.data?.or_id;
      if (!orderId) throw new Error("Order was created but no order id was returned");

      await Promise.all(
        cart.map((item) =>
          createOrderItem({
            Bpro_id: item.Bpro_id,
            pro_quantity: item.qty,
            unit_price: item.unitPrice,
            order_id: orderId,
          }),
        ),
      );

      printKot(
        { or_id: orderId, or_type: orderType },
        cart.map((i) => ({ name: i.pro_name, qty: i.qty, note: notes || "" })),
        {
          branchName,
          staffName: `${user?.u_fname || ""} ${user?.u_lname || ""}`.trim(),
        },
      );

      // The order is now the kitchen's; keep editing it so Checkout settles
      // this same ticket instead of raising a second one.
      setEditingOrderId(orderId);
      setEditingOrderCurrentStatus("pending");
      setSentToKitchen(true);
    } catch (kotError) {
      setError(
        kotError?.response?.data?.message ||
        kotError.message ||
        "Could not send the order to the kitchen",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /** Manager has entered their PIN — carry straight on with the sale. */
  const approveAndContinue = () => {
    approvalPinRef.current = pinEntry;
    setPinPromptOpen(false);
    setPinEntry("");
    handleCheckout();
  };

  const handleCheckout = async () => {
    if (!cart.length || !user?.u_id) {
      return;
    }
    setSuccessNote("");

    if (!branchId) {
      setError("No branch is assigned to this user.");
      return;
    }
    // Ask for the manager's PIN before anything is sent, rather than letting the
    // cashier reach the end of a sale and be refused in front of the customer.
    if (Number(discountPct || 0) > DISCOUNT_LIMIT_PCT && !approvalPinRef.current && !isManager) {
      setPinEntry("");
      setPinPromptOpen(true);
      return;
    }
    // Settling a waiter's order edits a sale that lives on the server, and
    // rewrites its lines. There is nothing sensible to queue: the till has no
    // way to know what that order looks like now.
    if (editingOrderId && !online) {
      setError(
        "This order was started elsewhere and needs the connection to settle. " +
        "Take the payment and ring it up here as a new sale, or wait for the connection.",
      );
      return;
    }
    // Dine-in without a table — treat as counter dine-in (no table reservation needed)
    // table_id remains null for cashier counter dine-in orders

    // A guest ringing down from their room is not a sale at the till: no money
    // changes hands now, the food goes to the kitchen, and the charge waits on
    // the folio until they check out. The hotel endpoint does all three, and
    // refuses a room whose guest has already left.
    if (paymentMethod === "Room") {
      // Charging a room means answering a question only the server can: is this
      // guest still in house? Queueing it offline could put a meal on the bill
      // of someone who checked out an hour ago, and nobody would find it until
      // the next guest disputed their folio. Refused, with the way out named.
      if (!online) {
        setError(
          "Room charges need the connection — the guest's booking has to be checked. " +
          "Take payment as cash or card for now, or hold the order.",
        );
        return;
      }
      if (!chargeRoomId) {
        setRoomPickerOpen(true);   // ask, rather than scold
        return;
      }
      try {
        setSubmitting(true);
        setError("");
        const room = occupiedRooms.find((r) => String(r.room_id) === String(chargeRoomId));
        const res = await createRoomServiceOrder({
          room_id: Number(chargeRoomId),
          tax_pct: Number((effectiveTaxRate * 100).toFixed(2)),
          items: cart.map((item) => ({
            Bpro_id: item.Bpro_id,
            pro_quantity: item.qty,
            unit_price: item.unitPrice,
          })),
        });
        // printKot(order, items, meta) — three arguments. Passing one object
        // left `items` undefined and printed a ticket with nothing on it.
        printKot(
          {
            or_id: res?.order?.or_id,
            or_type: "room_service",
            table: `Room ${room?.room_number ?? ""}${room?.guest_name ? ` · ${room.guest_name}` : ""}`,
          },
          cart.map((i) => ({ name: i.pro_name, qty: i.qty, note: notes || "" })),
          {
            branchName,
            staffName: `${user?.u_fname || ""} ${user?.u_lname || ""}`.trim(),
          },
        );
        setCart([]);
        setSentToKitchen(false);
        setChargeRoomId("");
        setPaymentMethod("Cash");
        setError("");
        setSuccessNote(
          `Charged to Room ${room?.room_number ?? ""} — ${room?.guest_name ?? "guest"}. It will appear on their bill at check-out.`,
        );
      } catch (roomError) {
        setError(
          roomError?.response?.data?.message ||
            "Could not charge that room. The guest may have checked out already.",
        );
        // 409 means that room is no longer chargeable — the guest checked out
        // while the order was being rung up. Keeping it selected would let the
        // cashier press again and fail forever, so drop it and refresh the list
        // to what is actually in house. Any other failure (a network blip) keeps
        // the selection so the same order can simply be retried.
        if (roomError?.response?.status === 409) {
          setChargeRoomId("");
          try {
            const grid = await getRoomGrid({ b_id: branchId });
            const rooms = Array.isArray(grid) ? grid : (grid?.rooms ?? []);
            setOccupiedRooms(rooms);
          } catch { /* the list refreshes on the next load anyway */ }
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      let orderId = editingOrderId;
      const roundedTaxRate = Number(effectiveTaxRate.toFixed(4));


      if (editingOrderId) {
        // Auto-advance pending → preparing so that preparing → completed is valid
        if (editingOrderCurrentStatus === "pending") {
          await updateOrderStatus(editingOrderId, "preparing");
        }

        // Update existing order (now at "preparing" or already "preparing")
        await updateOrder(editingOrderId, {
          or_tax: roundedTaxRate,
          or_totalcost: Number(taxableBase.toFixed(2)),
          or_totalCostWtax: Number(total.toFixed(2)),
          or_status: "completed",
          or_type: orderType,
          cust_id: null,
          u_id: user.u_id,
          b_id: branchId,
          table_id: editingOrderTableId ?? null,
        });

        // Fetch existing items to delete them
        const existingItems = await getOrderItemsByOrderId(editingOrderId);
        if (existingItems && existingItems.length > 0) {
          await Promise.all(
            existingItems.map((item) => deleteOrderItem(item.orderItem_id))
          );
        }
        await Promise.all(
          cart.map((item) =>
            createOrderItem({
              Bpro_id: item.Bpro_id,
              pro_quantity: item.qty,
              unit_price: item.unitPrice,
              order_id: orderId,
            }),
          ),
        );
      } else {
        // The sale gets its key here, before the first attempt. Everything after
        // this — a retry, a queued flush tomorrow morning — carries the same
        // key, so the sale can be sent as many times as it takes and still be
        // one sale.
        const sale = {
          order: {
            or_tax: roundedTaxRate,
            or_totalcost: Number(taxableBase.toFixed(2)),
            or_totalCostWtax: Number(total.toFixed(2)),
            or_status: "pending",
            or_type: orderType,
            cust_id: null,
            u_id: user.u_id,
            b_id: branchId,
            table_id: null,
            client_ref: newClientRef(),
            // The server works the total out again from its own menu, so the
            // discount has to travel with the sale rather than being quietly
            // baked into a smaller number.
            discount_pct: Number(discountPct || 0),
            service_fee: Number(serviceFee || 0),
            // How it was paid, sent with the sale itself. Without this the
            // drawer cannot be counted at the end of the day: there is no way
            // to tell which takings were notes and which were card.
            payment_method: String(paymentMethod || "cash").toLowerCase(),
            ...(approvalPinRef.current ? { approval_pin: approvalPinRef.current } : {}),
          },
          items: cart.map((item) => ({
            Bpro_id: item.Bpro_id,
            pro_quantity: item.qty,
            unit_price: item.unitPrice,
          })),
        };

        try {
          const orderResponse = await createOrderWithItems(sale);
          orderId = orderResponse?.data?.or_id;
          if (!orderId) throw new Error("Order was created but no order id was returned");
        } catch (err) {
          // The server said no — bad data, a product that has gone. Queueing
          // that would only fail again tomorrow, so it surfaces now.
          if (!isOffline(err)) throw err;

          // The network is down. The sale is kept exactly as it would have been
          // sent, and goes out the moment the connection is back.
          queueSale(sale);
          setCart([]);
          setSentToKitchen(false);
          setEditingOrderId(null);
          setEditingOrderCurrentStatus(null);
          setEditingOrderTableId(null);
          setSubmitting(false);
          setSuccessNote(
            `Saved offline — LKR ${total.toFixed(2)} taken. It will be sent automatically ` +
            `when the connection is back. Nothing is lost if this till is closed.`,
          );
          return;
        }
      }

      const invoiceItems = cart.map((item) => ({
        Bpro_id: item.Bpro_id,
        pro_name: item.pro_name,
        unitPrice: item.unitPrice,
        originalPrice: item.originalPrice || null,
        discountPct: item.discountPct || 0,
        qty: item.qty,
        total: Number((item.unitPrice * item.qty).toFixed(2)),
      }));

      setCart([]);
      setSentToKitchen(false);
      setEditingOrderId(null);
      setEditingOrderCurrentStatus(null);
      setEditingOrderTableId(null);
      // One approval, one sale — the next big discount asks again.
      approvalPinRef.current = "";
      navigate("/cashier/invoice-preview", {
        state: {
          orderId,
          cashierName: `${user?.u_fname || "Cashier"} ${user?.u_lname || ""}`.trim(),
          branchName,
          branchLabel: `${branchName.split(" ")[0] || branchName}\nBranch`,
          paymentMethod,
          items: invoiceItems,
          subtotal: Number(subtotal.toFixed(2)),
          discount: Number(discountPct || 0),
          serviceFee: Number(serviceFee || 0),
          allergies,
          addons,
          notes,
          tax: Number(tax.toFixed(2)),
          total: Number(total.toFixed(2)),
        },
      });
    } catch (checkoutError) {
      setError(
        checkoutError?.response?.data?.error ||
        checkoutError?.response?.data?.message ||
        checkoutError.message ||
        "Checkout failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditWaiterOrder = async (ao) => {
    try {
      setLoadingWaiterOrders(true);
      const items = await getOrderItemsByOrderId(ao.or_id);
      
      const newCart = items.map((item) => {
        const matchedProduct = products.find((p) => p.Bpro_id === item.Bpro_id);
        return {
          Bpro_id: item.Bpro_id,
          pro_name: item.pro_name,
          unitPrice: Number(item.unit_price || item.branch_price || 0),
          qty: Number(item.pro_quantity || 1),
          taxGroup: Number(matchedProduct?.tax_group ?? item.tax_group ?? 5),
        };
      });

      setCart(newCart);
      setOrderType(ao.or_type || "takeaway");
      setNotes(ao.or_notes || "");
      setEditingOrderId(ao.or_id);
      setEditingOrderCurrentStatus(ao.or_status ?? "pending");
      setEditingOrderTableId(ao.table_id ?? null);
      setShowWaiterOrdersModal(false);
    } catch (err) {
      alert("Failed to load order for editing: " + err.message);
    } finally {
      setLoadingWaiterOrders(false);
    }
  };

  const handleHoldOrder = () => {
    if (cart.length === 0) return;
    setPendingHoldData({
      cart: [...cart],
      paymentMethod,
      orderType,
      allergies,
      addons,
      notes,
      discountPct,
      serviceFee,
    });
    setHoldTableInput("");
    setShowHoldTableModal(true);
  };

  const confirmHoldOrder = (tableLabel) => {
    if (!pendingHoldData) return;
    const newHeldOrder = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tableLabel: tableLabel.trim() || null,
      ...pendingHoldData,
    };
    setHeldOrders((prev) => [...prev, newHeldOrder]);
    setPendingHoldData(null);
    setShowHoldTableModal(false);

    setCart([]);
    setPaymentMethod("Cash");
    setOrderType("takeaway");
    setAllergies("");
    setAddons("");
    setNotes("");
    setDiscountPct(0);
    setServiceFee(0);
  };

  const handleResumeOrder = (holdId) => {
    const orderToResume = heldOrders.find((ho) => ho.id === holdId);
    if (!orderToResume) return;

    if (cart.length > 0) {
      const autoHeld = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tableLabel: null,
        cart: [...cart],
        paymentMethod,
        orderType,
        allergies,
        addons,
        notes,
        discountPct,
        serviceFee,
      };
      setHeldOrders((prev) => [...prev, autoHeld]);
    }

    setCart(orderToResume.cart);
    setPaymentMethod(orderToResume.paymentMethod);
    setOrderType(orderToResume.orderType);
    setAllergies(orderToResume.allergies || "");
    setAddons(orderToResume.addons || "");
    setNotes(orderToResume.notes || "");
    setDiscountPct(orderToResume.discountPct || 0);
    setServiceFee(orderToResume.serviceFee || 0);

    setHeldOrders((prev) => prev.filter((ho) => ho.id !== holdId));
    setShowHeldOrdersModal(false);
  };

  const handleRemoveHeldOrder = (holdId) => {
    setHeldOrders((prev) => prev.filter((ho) => ho.id !== holdId));
  };

  const logoutAndNavigate = () => {
    logout();
  };

  const selectedProductCount = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F3F7FB] text-slate-900">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header
          title="Point of Sale"
          actions={
            <>
              <button type="button" onClick={() => setShowHeldOrdersModal(true)} style={headerBtn(false)}>
                Held Orders ({heldOrders.length})
              </button>
              <button type="button" onClick={handleOpenWaiterOrders} style={headerBtn(waiterOrders.length > 0)}>
                Waiter Orders ({waiterOrders.length})
              </button>
              {/* Highlighted when no drawer is open — a cash sale with no shift
                  behind it cannot be counted at the end of the day. */}
              <button type="button" onClick={() => setDrawerOpen(true)}
                style={headerBtn(drawer ? !drawer.open : false)}>
                {drawer?.open ? "Drawer" : "Open Drawer"}
              </button>
            </>
          }
        />

      {drawerOpen && (
        <CashDrawerModal
          branchId={branchId}
          onClose={() => setDrawerOpen(false)}
          onChanged={refreshDrawer}
        />
      )}

      <OrderReadyAlerts alerts={orderReadyAlerts} onDismiss={handleDismissOrderReady} />

      {/* New waiter order toasts */}
      {newWaiterToasts.length > 0 && (
        <div className="fixed top-20 left-4 z-[9999] flex flex-col gap-2 w-[min(92vw,360px)]">
          {newWaiterToasts.map((t) => (
            <div key={t.id} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-lg flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">!</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-900">New Waiter Order</p>
                <p className="mt-0.5 text-sm text-blue-800">Order #{t.orderId} arrived — check Waiter Orders</p>
              </div>
              <button
                onClick={() => setNewWaiterToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="ml-1 rounded-md px-2 py-1 text-sm font-semibold text-blue-900 hover:bg-blue-200"
              >×</button>
            </div>
          ))}
        </div>
      )}

      <main className="flex w-full flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-hidden">
        {/* The manager types this on the cashier's screen — nobody logs out, no
            password changes hands, and who approved it is stored on the sale. */}
        {pinPromptOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-800">Manager approval needed</h3>
              <p className="mt-1 text-sm text-slate-500">
                A {Number(discountPct)}% discount is over the {DISCOUNT_LIMIT_PCT}% limit.
                Ask a manager to enter their PIN.
              </p>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pinEntry}
                onChange={(e) => setPinEntry(e.target.value.replace(/\D/g, "").slice(0, 8))}
                onKeyDown={(e) => { if (e.key === "Enter" && pinEntry) approveAndContinue(); }}
                placeholder="Manager PIN"
                className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-[#0A5BAE] focus:ring-1 focus:ring-[#0A5BAE]"
              />
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => { setPinPromptOpen(false); setPinEntry(""); }}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  disabled={!pinEntry}
                  onClick={approveAndContinue}
                  className="flex-1 rounded-xl bg-[#0A5BAE] py-2.5 text-sm font-semibold text-white hover:bg-[#094f96] disabled:opacity-40"
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Amber, not red: this is a state to work in, not a failure. Silence
            would be worse — a cashier needs to know the till is on its own
            before they promise a guest their food is on the way. */}
        {!online ? (
          <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">Working offline.</span>{" "}
            Sales are being saved on this till and will be sent automatically when the
            connection returns. Room charges and settling a waiter&apos;s order need the
            connection and are paused.
          </div>
        ) : null}

        {pending.queued ? (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <span>
              <span className="font-semibold">{pending.queued}</span>{" "}
              sale{pending.queued === 1 ? "" : "s"} waiting to be sent.
              {online ? " Sending…" : " They will go up on their own."}
            </span>
            {online ? (
              <button type="button" onClick={sendQueuedNow}
                className="shrink-0 rounded-lg bg-[#0A5BAE] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#094f96]">
                Send now
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A sale the server refused will never succeed on a retry, so it stops
            here and waits for a person rather than looping in the background. */}
        {pending.parked ? (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span>
              <span className="font-semibold">{pending.parked}</span>{" "}
              offline sale{pending.parked === 1 ? "" : "s"} could not be accepted and need
              re-entering. Reason: {parkedSales()[0]?.reason ?? "unknown"}
            </span>
            <button type="button" onClick={() => { clearParked(); setPending({ queued: queuedCount(), parked: 0 }); }}
              className="shrink-0 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100">
              Dismiss
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {successNote ? (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{successNote}</span>
            <button type="button" onClick={() => setSuccessNote("")}
              className="shrink-0 text-emerald-600 hover:text-emerald-800" aria-label="Dismiss">
              ✕
            </button>
          </div>
        ) : null}

        <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex flex-col gap-5 lg:min-h-0 lg:overflow-hidden">
            <div className="shrink-0 rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 sm:p-5">
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search products by name or description..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const on = String(selectedCategoryId) === String(cat.cat_id);
                  return (
                    <button
                      key={cat.cat_id}
                      onClick={() => setSelectedCategoryId(cat.cat_id)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${on
                          ? "border-sky-500 bg-linear-to-r from-[#0A5BAE] to-[#19A4E5] text-white shadow-md shadow-sky-200"
                          : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
                        }`}
                    >
                      {cat.cat_id === "all" ? <FaStore className="h-4 w-4" /> : <FaUtensils className="h-4 w-4" />}
                      {cat.cat_name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid auto-rows-min content-start gap-2 pb-1 pr-1 grid-cols-2 sm:grid-cols-3 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:overflow-y-auto xl:grid-cols-5 2xl:grid-cols-6">
              {loading ? (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  Loading products from the backend...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No products match your search.
                </div>
              ) : (
                filteredProducts.map((product, index) => {
                  // Icon and colour come from the same guess, so the grid reads
                  // as a menu with rhythm rather than a wall of identical tiles.
                  const { Icon, chip, ring } = (() => {
                    const source = `${product.pro_name ?? ""} ${product.pro_des ?? ""}`.toLowerCase();
                    const has = (...words) => words.some((w) => source.includes(w));

                    // Tints stay very light: this fills the whole image area,
                    // and a wall of saturated blocks is louder than a menu needs.
                    if (has("coffee", "tea", "juice", "shake", "smoothie"))
                      return { Icon: FaCoffee, chip: "bg-amber-50 text-amber-500", ring: "hover:border-amber-300" };
                    if (has("beer", "wine", "whiskey", "cocktail", "arrack", "vodka", "gin"))
                      return { Icon: FaWineGlassAlt, chip: "bg-violet-50 text-violet-400", ring: "hover:border-violet-300" };
                    if (has("suite", "laundry", "parking", "checkout", "desk", "service"))
                      return { Icon: FaDesktop, chip: "bg-slate-100 text-slate-400", ring: "hover:border-slate-300" };
                    return { Icon: FaUtensils, chip: "bg-orange-50 text-orange-400", ring: "hover:border-orange-300" };
                  })();

                  const stockCount = Number(product.pro_quantity ?? 0);
                  const basePrice = Number(product.pro_price ?? 0);
                  const discPct = Number(product.discount_pct ?? 0);
                  const effectivePrice = discPct > 0
                    ? parseFloat((basePrice * (1 - discPct / 100)).toFixed(2))
                    : basePrice;
                  const soldOut = stockCount <= 0;
                  const lowStock = stockCount > 0 && stockCount <= 5;
                  const hasPhoto = product.pro_image &&
                    (product.pro_image.startsWith("http") || product.pro_image.startsWith("data:"));

                  return (
                    <article
                      key={product.Bpro_id ?? index}
                      onClick={() => (soldOut ? undefined : addToCart(product))}
                      title={soldOut ? `${product.pro_name} — out of stock` : `Add ${product.pro_name}`}
                      className={`group relative flex flex-col rounded-xl border bg-white p-2 transition duration-200 ${
                        soldOut
                          ? "cursor-not-allowed border-slate-200 opacity-60"
                          : "cursor-pointer border-slate-100 shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)]"
                      }`}
                    >
                      {/* The picture leads, the way the reference card does. The
                          two badges ride on it so the text below stays clean. */}
                      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-slate-50">
                        {hasPhoto ? (
                          <img
                            src={product.pro_image}
                            alt=""
                            className={`h-full w-full object-cover transition duration-300 ${soldOut ? "grayscale" : "group-hover:scale-105"}`}
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

                        {/* Quiet until the cashier is over the card. */}
                        {!soldOut && (
                          <span className="pointer-events-none absolute bottom-1 right-1 flex h-6 w-6 translate-y-1 items-center justify-center rounded-full bg-[#0A5BAE] text-white opacity-0 shadow-md transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                            <FaPlus className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>

                      <h3
                        className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900"
                        title={product.pro_name}
                      >
                        {product.pro_name}
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
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <aside className="flex flex-col rounded-3xl bg-white shadow-[0_10px_30px_rgba(15,23,42,0.09)] ring-1 ring-slate-200/70 lg:min-h-0 lg:overflow-hidden">
            <div className="shrink-0 rounded-t-3xl bg-linear-to-r from-[#0A5BAE] to-[#19A4E5] px-5 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                    <FaShoppingCart className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Shopping Cart</h2>
                    <p className="text-xs text-white/80">
                      {selectedProductCount} item{selectedProductCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setCart([])}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
                >
                  <FaTrashAlt className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {cart.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Add products from the left panel to build the order.
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.Bpro_id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{item.pro_name}</h3>
                      <span className="text-[13px] font-semibold tracking-tight text-slate-900">
                        LKR {(item.unitPrice * item.qty).toFixed(2)}
                      </span>
                      <button
                        onClick={() => removeFromCart(item.Bpro_id)}
                        aria-label={`Remove ${item.pro_name}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-rose-500"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5">
                        <button
                          onClick={() => updateQuantity(item.Bpro_id, -1)}
                          aria-label="Decrease quantity"
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100"
                        >
                          <FaMinus className="h-2.5 w-2.5" />
                        </button>
                        <span className="min-w-6 text-center text-xs font-semibold">{item.qty}</span>
                        <button
                          onClick={() => updateQuantity(item.Bpro_id, 1)}
                          aria-label="Increase quantity"
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100"
                        >
                          <FaPlus className="h-2.5 w-2.5" />
                        </button>
                      </div>

                      <div className="flex items-baseline gap-1.5 text-[11px] text-slate-500">
                        <span>LKR {item.unitPrice.toFixed(2)} ea</span>
                        {item.originalPrice && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            -{item.discountPct}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Collapsed by default: three always-open inputs cost more height
                  than a whole cart line, and most orders never need them. */}
              {(() => {
                const filled = [allergies, addons, notes].filter((v) => v && v.trim()).length;
                return (
                  <div className="rounded-xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setShowOrderNotes((v) => !v)}
                      className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      <span>Allergies, add-ons &amp; notes{filled > 0 ? ` (${filled})` : ""}</span>
                      <span className="text-slate-400">{showOrderNotes ? "−" : "+"}</span>
                    </button>

                    {showOrderNotes && (
                      <div className="grid gap-2 border-t border-slate-100 p-3">
                        <input
                          aria-label="allergies"
                          type="text"
                          value={allergies}
                          onChange={(e) => setAllergies(e.target.value)}
                          placeholder="Allergies / Dietary (e.g., Nuts, Gluten)"
                          className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs outline-none"
                        />
                        <input
                          aria-label="addons"
                          type="text"
                          value={addons}
                          onChange={(e) => setAddons(e.target.value)}
                          placeholder="Add Ons (e.g., Extra cheese)"
                          className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs outline-none"
                        />
                        <input
                          aria-label="notes"
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Notes (special requests)"
                          className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Pinned: the money and the buttons never scroll out of reach.
                Kept deliberately tight — every pixel this takes is a pixel the
                cashier cannot use to see what they have rung up. Order type and
                payment sit side by side rather than in two stacked cards. */}
            <div className="shrink-0 space-y-2.5 border-t border-slate-200 px-4 pb-4 pt-3 sm:px-5">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between text-[13px] text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-semibold text-slate-900">LKR {subtotal.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[13px] text-slate-500">
                  <span>Tax {effectiveTaxRate > 0 ? `(${effectiveTaxRate.toFixed(1)}%)` : ""}</span>
                  <span className="font-semibold text-slate-900">LKR {tax.toFixed(2)}</span>
                </div>
                <div className="my-2 h-px bg-slate-200" />
                <div className="flex items-baseline justify-between font-semibold text-slate-900">
                  <span className="text-sm">Total</span>
                  <span className="text-xl tracking-tight">LKR {total.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order Type</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[["takeaway", "Takeaway"], ["dine-in", "Dine-in"]].map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setOrderType(value)}
                        className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                          orderType === value
                            ? "border-[#55C24A] bg-emerald-50 text-slate-900 ring-1 ring-emerald-200"
                            : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment</h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    {["Cash", "Card", "Room"].map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(method);
                          // Choosing "Room" is a question — which room? — so ask
                          // it straight away instead of leaving a second tap
                          // between the cashier and the answer.
                          if (method === "Room" && !chargeRoomId) {
                            setRoomQuery("");
                            setRoomPickerOpen(true);
                          }
                        }}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                          paymentMethod === method
                            ? "border-[#55C24A] bg-emerald-50 text-slate-900 ring-1 ring-emerald-200"
                            : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${paymentMethod === method ? "bg-[#00B67A]" : "bg-slate-300"}`} />
                        {method}
                      </button>
                    ))}
                  </div>

                  {/* Charging to a room is not a way of paying — it is a way of
                      deferring payment onto the guest's folio, so the room has
                      to be named before the order can go anywhere. */}
                  {paymentMethod === "Room" && (
                    <div className="mt-2">
                      {inHouseCount === 0 ? (
                        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                          No guests are checked in, so there is no room to charge. Take payment instead.
                        </p>
                      ) : (
                        <>
                          {/* A button, not a dropdown. A property with eighty rooms
                              cannot be scrolled through in a 340px sidebar, and the
                              cashier usually already knows the number or the name. */}
                          <button
                            type="button"
                            onClick={() => setRoomPickerOpen(true)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                              chargeRoom
                                ? "border-emerald-300 bg-emerald-50 text-slate-900"
                                : "border-slate-200 bg-white text-slate-500 hover:border-sky-300"
                            }`}
                          >
                            {chargeRoom ? (
                              <span className="min-w-0">
                                <span className="font-semibold">Room {chargeRoom.room_number}</span>
                                <span className="block truncate text-[11px] text-slate-500">{chargeRoom.guest_name}</span>
                              </span>
                            ) : (
                              <span>Choose the guest&apos;s room…</span>
                            )}
                            <span className="shrink-0 text-[11px] font-semibold text-[#0A5BAE]">
                              {chargeRoom ? "Change" : `${inHouseCount} in house`}
                            </span>
                          </button>
                          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
                            Goes to the kitchen and onto the guest&apos;s bill. Nothing is collected now.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Charging a room already tickets the kitchen and bills the guest in
                  one transaction. Leaving this button here let a cashier send a
                  second, detached order that the kitchen cooked and nobody paid
                  for. In Room mode there is one action, below. */}
              <button
                type="button"
                onClick={handleSendToKitchen}
                hidden={paymentMethod === "Room"}
                disabled={submitting || cart.length === 0 || sentToKitchen || paymentMethod === "Room"}
                className={`mt-0.5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  sentToKitchen
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : "bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                }`}
              >
                <FaUtensils className="h-3.5 w-3.5" />
                {sentToKitchen ? "Sent to Kitchen" : "Send to Kitchen (KOT)"}
              </button>

              <div className="flex gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={handleHoldOrder}
                  disabled={submitting || cart.length === 0}
                  className="inline-flex flex-1 items-center justify-center rounded-xl border border-[#0A5BAE] bg-white px-3 py-3 text-sm font-semibold text-[#0A5BAE] transition hover:bg-[#0A5BAE] hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Hold
                </button>

                <button
                  onClick={handleCheckout}
                  disabled={submitting || cart.length === 0 || !branchId}
                  className="inline-flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#55C24A] px-3 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(85,194,74,0.25)] transition hover:bg-[#49b03f] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  <FaShoppingCart className="h-4 w-4" />
                  {submitting
                    ? "Processing..."
                    : paymentMethod === "Room"
                      ? (chargeRoom ? `Charge to Room ${chargeRoom.room_number}` : "Charge to Room")
                      : "Checkout"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Held Orders Modal */}
      {/* Hold Order — Table Number Prompt */}
      {showHoldTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Hold Order</h2>
            <p className="text-sm text-slate-500 mb-4">Enter the table number for this held order (optional).</p>
            <input
              type="text"
              value={holdTableInput}
              onChange={(e) => setHoldTableInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmHoldOrder(holdTableInput); }}
              placeholder="e.g. 5 or A3"
              autoFocus
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#0A5BAE] focus:ring-1 focus:ring-[#0A5BAE] mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowHoldTableModal(false); setPendingHoldData(null); }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmHoldOrder(holdTableInput)}
                className="flex-1 rounded-xl bg-[#0A5BAE] py-2.5 text-sm font-semibold text-white hover:bg-[#094f96]"
              >
                Hold Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charging a room is a search, not a scroll: type the number the caller
          gives you, or their name if they only give that. */}
      {roomPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setRoomPickerOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800">Charge to a room</h2>
                {chargeRoom ? (
                  <p className="truncate text-xs font-semibold text-emerald-700">
                    Currently: Room {chargeRoom.room_number} — {chargeRoom.guest_name}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">{inHouseCount} guests in house · {occupiedRooms.length} rooms</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRoomPickerOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {chargeRoom && (
              <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5">
                <span className="min-w-0 text-sm text-emerald-900">
                  Charging to <strong>Room {chargeRoom.room_number}</strong>
                  <span className="block truncate text-xs text-emerald-700">{chargeRoom.guest_name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setChargeRoomId(""); setRoomQuery(""); }}
                  className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="px-5 pt-4">
              <input
                autoFocus
                value={roomQuery}
                onChange={(e) => setRoomQuery(e.target.value)}
                placeholder="Room number or guest name…"
                aria-label="Search rooms"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 overflow-y-auto p-5 sm:grid-cols-3">
              {roomMatches.length === 0 ? (
                <p className="col-span-full py-8 text-center text-sm text-slate-500">
                  {occupiedRooms.length === 0
                    ? "No rooms are set up yet."
                    : `No room or guest matches “${roomQuery.trim()}”.`}
                </p>
              ) : (
                roomMatches.map((r) => {
                  const on = String(r.room_id) === String(chargeRoomId);
                  const free = !canCharge(r);
                  // Why this room cannot be charged, in the words the desk uses.
                  const why =
                    r.status === "booked" ? "Arriving — not checked in"
                    : r.status === "dirty" ? "Needs cleaning"
                    : r.status === "occupied" ? "No guest on file"
                    : "Empty";
                  return (
                    <button
                      key={r.room_id}
                      type="button"
                      disabled={free}
                      title={free ? why : `Charge to Room ${r.room_number}`}
                      onClick={() => {
                        if (free) return;
                        setChargeRoomId(String(r.room_id));
                        setRoomQuery("");
                        setRoomPickerOpen(false);
                      }}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        free
                          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                          : on
                            ? "border-[#55C24A] bg-emerald-50 ring-2 ring-[#55C24A]"
                            : "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50"
                      }`}
                    >
                      <span className={`block text-sm font-bold ${free ? "text-slate-400" : "text-slate-800"}`}>
                        Room {r.room_number}
                      </span>
                      {free ? (
                        <span className="block truncate text-xs italic text-slate-400">{why}</span>
                      ) : (
                        <span className="block truncate text-xs font-medium text-slate-700">{r.guest_name}</span>
                      )}
                      {r.type_name && (
                        <span className={`block truncate text-[10.5px] ${free ? "text-slate-300" : "text-slate-400"}`}>
                          {r.type_name}
                        </span>
                      )}
                      {on && (
                        <span className="mt-1.5 block rounded-md bg-[#55C24A] py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white">
                          ✓ Selected
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showHeldOrdersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl relative max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 border-b pb-4">
              <h2 className="text-xl font-bold text-slate-800">Held Orders ({heldOrders.length})</h2>
              <button 
                onClick={() => setShowHeldOrdersModal(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            
            <div className="flex flex-col gap-4">
              {heldOrders.length === 0 ? (
                <div className="text-center py-6 text-slate-500">No held orders available.</div>
              ) : (
                heldOrders.map((ho) => (
                  <div key={ho.id} className="flex justify-between items-center rounded-xl border p-4 hover:shadow-md transition">
                    <div>
                      <div className="font-semibold text-slate-800">
                        {ho.tableLabel ? `Table ${ho.tableLabel}` : "No Table"} — {ho.timestamp}
                      </div>
                      <div className="text-sm text-slate-500">
                        {ho.cart.length} items • {ho.orderType} • {ho.paymentMethod}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRemoveHeldOrder(ho.id)}
                        className="rounded-lg bg-red-50 text-red-500 px-3 py-2 text-sm font-medium hover:bg-red-100"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => handleResumeOrder(ho.id)}
                        className="rounded-lg bg-[#0A5BAE] text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700"
                      >
                        Resume
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Waiter Orders Modal */}
      {showWaiterOrdersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 border-b pb-4">
              <h2 className="text-xl font-bold text-slate-800">Waiter Orders ({waiterOrders.length})</h2>
              <div className="flex gap-2">
                <button
                  onClick={fetchWaiterOrders}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                >
                  Refresh
                </button>
                <button
                  onClick={() => setShowWaiterOrdersModal(false)}
                  className="rounded-lg bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {loadingWaiterOrders ? (
                <div className="text-center py-6 text-slate-500">Loading orders...</div>
              ) : waiterOrders.length === 0 ? (
                <div className="text-center py-6 text-slate-500">No waiter orders available.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {waiterOrders.map((ao) => (
                    <div key={ao.or_id} className="flex flex-col justify-between rounded-xl border p-4 shadow-sm hover:shadow-md transition">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-semibold text-slate-800 text-lg">Order #{ao.or_id}</div>
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide ${ao.or_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                              ao.or_status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                                ao.or_status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                  ao.or_status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                    'bg-slate-100 text-slate-700'
                            }`}>
                            {ao.or_status?.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="text-sm text-slate-500 space-y-1">
                          <p><strong>Table:</strong> {ao.table_id ? `Table ${ao.table_id}` : '—'}</p>
                          <p><strong>Type:</strong> {ao.or_type}</p>
                          <p><strong>Total:</strong> LKR {Number(ao.or_totalCostWtax || ao.or_totalcost || 0).toFixed(2)}</p>
                          {ao.or_notes && <p className="text-xs italic mt-2 text-red-500 line-clamp-2">{ao.or_notes}</p>}
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t flex flex-col gap-2">
                        {ao.or_status === "cancelled" ? (
                          <div className="w-full rounded-lg bg-red-50 border border-red-200 text-red-600 px-4 py-2 text-sm font-semibold text-center">
                            Cancelled
                          </div>
                        ) : (
                          <button
                            onClick={() => handleEditWaiterOrder(ao)}
                            disabled={loadingWaiterOrders}
                            className="w-full rounded-lg bg-[#0A5BAE] text-white px-4 py-2 text-sm font-semibold hover:bg-[#094f96] transition"
                          >
                            Bill &amp; Pay at Terminal
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

/** Page buttons that sit in the shared header — quiet on it, not competing. */
const headerBtn = (highlight) => ({
  padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: "pointer", whiteSpace: "nowrap",
  border: `1px solid ${highlight ? "#FDE68A" : "rgba(255,255,255,0.35)"}`,
  background: highlight ? "#FDE68A" : "rgba(255,255,255,0.15)",
  color: highlight ? "#92400E" : "#fff",
});

export default CashierPos;
