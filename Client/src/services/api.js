import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const api = axios.create({
  baseURL: BASE_URL,
});

// restore token from localStorage (if present)
const existingToken = localStorage.getItem("token");
if (existingToken) {
  api.defaults.headers.common["Authorization"] = `Bearer ${existingToken}`;
}

// Global response interceptor — only clears token and redirects on 401 (expired/invalid token)
// A 403 (permission denied) means the user IS authenticated — do NOT log them out
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn("[AUTH] 401 — token expired or invalid. Clearing session and redirecting to login.");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      delete api.defaults.headers.common["Authorization"];
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    localStorage.setItem("token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("token");
  }
};

export const login = async ({ u_email, u_pw }) => {
  const res = await api.post("/auth/login", { u_email, u_pw });
  return res.data; // { token, user }
};

export const logout = () => {
  setAuthToken(null);
  localStorage.removeItem("user");
};

export const getCurrentUser = () => {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
};

/* API helpers (use `api` so Authorization header is applied automatically) */

export const getBranches = async () => {
  const response = await api.get("/branches");
  return response.data;
};

export const deleteBranch = async (id) => {
  const response = await api.delete(`/branches/${id}`);
  return response.data;
};

export const getUsers = async () => {
  const response = await api.get("/users");
  return response.data;
};

export const getRoles = async () => {
  const response = await api.get("/roles");
  return response.data;
};

export const getCompanies = async () => {
  const response = await api.get("/companies");
  return response.data;
};

export const createCompany = async (companyData) => {
  const response = await api.post("/companies", companyData);
  return response.data;
};

export const updateCompany = async (id, companyData) => {
  const response = await api.put(`/companies/${id}`, companyData);
  return response.data;
};

export const deleteCompany = async (id) => {
  const response = await api.delete(`/companies/${id}`);
  return response.data;
};

export const getProducts = async () => {
  const response = await api.get("/products");
  return response.data;
};

export const getBranchProducts = async (branchId) => {
  const response = await api.get("/branch_products", {
    params: {
      ...(branchId ? { B_id: branchId } : {}),
      _ts: Date.now(),
    },
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  const data = response.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

export const createBranchProduct = async (branchProductData) => {
  const response = await api.post("/branch_products", branchProductData);
  return response.data;
};

export const updateBranchProduct = async (branchProductId, payload) => {
  const response = await api.put(`/branch_products/${branchProductId}`, payload);
  return response.data;
};

export const deleteBranchProduct = async (branchProductId) => {
  await api.delete(`/branch_products/${branchProductId}`);
};

export const getOrders = async (params = {}) => {
  const response = await api.get("/orders", { params });
  // order API wraps rows in { success, count, data }
  return response.data?.data || [];
};

export const getOrderItems = async (params = {}) => {
  const response = await api.get("/order-items", { params });
  return response.data?.data || [];
};

export const getOrderItemsByOrderId = async (orderId) => {
  const response = await api.get(`/order-items/order/${orderId}`);
  return response.data?.data || [];
};

export const updateOrderStatus = async (orderId, status) => {
  const response = await api.patch(`/orders/${orderId}/status`, { status });
  return response.data?.data;
};

export const getProductById = async (productId) => {
  const response = await api.get(`/products/${productId}`);
  return response.data;
};




export const getCategories = async () => {
  const response = await api.get("/categories");
  return response.data;
};

export const createCategory = async (payload) => {
  const response = await api.post("/categories", payload);
  return response.data;
};

export const updateCategory = async (catId, payload) => {
  const response = await api.put(`/categories/${catId}`, payload);
  return response.data;
};

export const deleteCategory = async (catId) => {
  const response = await api.delete(`/categories/${catId}`);
  return response.data;
};

export const getRawMaterials = async () => {
  const response = await api.get("/raw-materials");
  return response.data;
};

export const getRecipes = async () => {
  const response = await api.get("/recipes");
  return response.data;
};

export const getRecipeById = async (recipeId) => {
  const response = await api.get(`/recipes/${recipeId}`);
  return response.data;
};

export const getRecipesByProduct = async (productId) => {
  const response = await api.get(`/recipes/product/${productId}`);
  return response.data;
};

export const createRecipe = async (payload) => {
  const response = await api.post("/recipes", payload);
  return response.data;
};

export const createRecipeBulk = async (payload) => {
  const response = await api.post("/recipes/bulk", payload);
  return response.data;
};

export const updateRecipe = async (recipeId, payload) => {
  const response = await api.put(`/recipes/${recipeId}`, payload);
  return response.data;
};

export const deleteRecipe = async (recipeId) => {
  await api.delete(`/recipes/${recipeId}`);
};

export const deleteRecipeByProduct = async (productId) => {
  const response = await api.delete(`/recipes/product/${productId}`);
  return response.data;
};

export const getLowStockMaterials = async () => {
  const response = await api.get("/raw-materials/low-stock");
  return response.data;
};

export const createProduct = async (productData) => {
  const response = await api.post("/products", productData);
  return response.data;
};

export const createOrder = async (orderData) => {
  const response = await api.post("/orders", orderData);
  return response.data;
};

/**
 * A whole sale in one request — the order and its lines, in one transaction.
 *
 * `order.client_ref` must be set by the caller before the first attempt. The
 * server keys on it, so sending the same sale again returns the original
 * instead of creating a second one. That is what makes retrying after a dropped
 * connection, or flushing the offline queue, safe to do.
 */
export const createOrderWithItems = async ({ order, items }) => {
  const response = await api.post("/orders/with-items", { order, items });
  return response.data;
};

export const updateOrder = async (orderId, orderData) => {
  const response = await api.put(`/orders/${orderId}`, orderData);
  return response.data;
};

export const deleteOrderItem = async (orderItemId) => {
  const response = await api.delete(`/order-items/${orderItemId}`);
  return response.data;
};

export const getWaiterProfile = async () => {
  const response = await api.get("/waiter/profile");
  return response.data;
};

export const getWaiterTables = async (params = {}) => {
  const response = await api.get("/waiter/my-tables", { params });
  return response.data;
};

export const getWaiterOrders = async (params = {}) => {
  const response = await api.get("/waiter/my-orders", { params });
  return response.data;
};

export const createWaiterOrder = async (orderData) => {
  const response = await api.post("/waiter/orders", orderData);
  return response.data;
};

export const deleteWaiterOrder = async (orderId) => {
  const response = await api.delete(`/waiter/orders/${orderId}`);
  return response.data;
};

export const createOrderItem = async (orderItemData) => {
  const response = await api.post("/order-items", orderItemData);
  return response.data;
};

export const updateProduct = async (productId, payload) => {
  const response = await api.put(`/products/${productId}`, payload);
  return response.data;
};

export const deleteProduct = async (productId) => {
  await api.delete(`/products/${productId}`);
};

export const getUserById = async (userId) => {
  const response = await api.get(`/users/${userId}`);
  return response.data;
};

export const updateUser = async (id, payload) => {
  const response = await api.put(`/users/${id}`, payload);
  return response.data;
};

export const getBranchById = async (branchId) => {
  const response = await api.get(`/branches/${branchId}`);
  return response.data;
};

export const updateBranch = async (branchId, payload) => {
  const response = await api.put(`/branches/${branchId}`, payload);
  return response.data;
};

export const deleteBranchById = async (branchId) => {
  await api.delete(`/branches/${branchId}`);
};

export const createUser = async (userData) => {
  const res = await api.post(`/users`, userData);
  return res.data;
};

export const deleteUserById = async (userId) => {
  await api.delete(`/users/${userId}`);
};

export const createBranch = async (branchData) => {
  const res = await api.post(`/branches`, branchData);
  return res.data;
};

export const setupBranchWithManager = async (combinedData) => {
  try {
    // 1. Create the Branch first (no longer requires U_id)
    const newBranch = await createBranch({
      ...combinedData.branch,
      com_id: combinedData.com_id ?? 1,
    });

    const branchId = newBranch.B_id ?? newBranch.b_id ?? null;

    // 2. Create the User (Manager), linking them to the Branch using the newly created branchId
    const newUser = await createUser({
      ...combinedData.manager,
      B_id: branchId,
    });

    return { user: newUser, branch: newBranch };
  } catch (error) {
    throw error;
  }
};

export const getStatsOverview = async () => {
  const res = await api.get("/stats/overview");
  return res.data;
};

export const getBranchStats = async () => {
  const res = await api.get("/stats/branches");
  return res.data;
};

// Stats API helpers
export const getStatsSalesOverTime = async (params = {}) => {
  const res = await api.get("/stats/sales-over-time", { params });
  return res.data;
};

export const getStatsTypeBreakdown = async (params = {}) => {
  const res = await api.get("/stats/type-breakdown", { params });
  return res.data;
};

export const getStatsPeakHours = async (params = {}) => {
  const res = await api.get("/stats/peak-hours", { params });
  return res.data;
};

export const getStatsBusyDays = async (params = {}) => {
  const res = await api.get("/stats/busy-days", { params });
  return res.data;
};

export const getBranchComparison = async () => {
  const res = await api.get("/stats/branches/compare");
  return res.data;
};


// --- Transactions / purchases helpers (append these) ---
export const getOrderById = async (orderId) => {
  const response = await api.get(`/orders/${orderId}`);
  return response.data?.data || null;
};

export const getSuppliers = async (params = {}) => {
  const res = await api.get("/suppliers", { params });
  return res.data?.data ?? res.data ?? [];
};

export const getPurchaseOrders = async (params = {}) => {
  const res = await api.get("/purchase-orders", { params });
  return res.data?.data ?? res.data ?? [];
};

export const createPurchaseOrder = async (payload) => {
  const res = await api.post("/purchase-orders", payload);
  return res.data?.data ?? res.data;
};

export const createPurchaseItem = async (payload) => {
  const res = await api.post("/purchase-items", payload);
  return res.data?.data ?? res.data;
};

export const getPurchaseOrderById = async (id) => {
  const res = await api.get(`/purchase-orders/${id}`);
  return res.data || null;
};

export const getPurchaseItemsByOrder = async (orderId) => {
  const res = await api.get(`/purchase-items/order/${orderId}`);
  return res.data || [];
};

export const getSupplierPayments = async (params = {}) => {
  const res = await api.get("/supplier-payments", { params });
  return res.data || [];
};

export const getPaymentsByOrder = async (poId) => {
  const res = await api.get(`/supplier-payments/order/${poId}`);
  return res.data || [];
};

// Payments helper
export const getPayments = async (params = {}) => {
  const res = await api.get("/payments", { params });
  // payment API returns { success, data, meta } where data is an array
  return res.data?.data ?? [];
};

export const createPayment = async (payload) => {
  const res = await api.post("/payments", payload);
  return res.data;
};

// Discount helpers
export const getDiscounts = async (params = {}) => {
  const res = await api.get("/discounts", { params });
  return res.data?.data ?? [];
};

export const createDiscount = async (payload) => {
  const res = await api.post("/discounts", payload);
  return res.data;
};

export const updateDiscount = async (id, payload) => {
  const res = await api.put(`/discounts/${id}`, payload);
  return res.data;
};

export const patchDiscountApi = async (id, payload) => {
  const res = await api.patch(`/discounts/${id}`, payload);
  return res.data;
};

export const deleteDiscount = async (id) => {
  await api.delete(`/discounts/${id}`);
};

export const toggleDiscount = async (id) => {
  const res = await api.patch(`/discounts/${id}/toggle`);
  return res.data;
};

// ─── Reservations ────────────────────────────────────────────────────────────
export const getReservations = async (params = {}) => {
  const res = await api.get("/reservations", { params });
  return res.data ?? [];
};
export const getReservationsByBranch = async (branchId) => {
  const res = await api.get(`/reservations/branch/${branchId}`);
  return res.data ?? [];
};
export const createReservation = async (payload) => {
  const res = await api.post("/reservations", payload);
  return res.data;
};
export const updateReservation = async (id, payload) => {
  const res = await api.put(`/reservations/${id}`, payload);
  return res.data;
};
export const deleteReservation = async (id) => {
  await api.delete(`/reservations/${id}`);
};

// ─── Customers ───────────────────────────────────────────────────────────────
export const getCustomers = async (params = {}) => {
  const res = await api.get("/customers", { params });
  return res.data ?? [];
};
export const createCustomer = async (payload) => {
  const res = await api.post("/customers", payload);
  return res.data;
};

// ─── Tables (for reservation calendar) ───────────────────────────────────────
export const getBranchTables = async (branchId) => {
  const res = await api.get("/tables", { params: { branch_id: branchId } });
  return res.data ?? [];
};

// ─── Commission Agents ────────────────────────────────────────────────────────
export const getAgents = async (params = {}) => {
  const res = await api.get("/commission/agents", { params });
  return res.data ?? [];
};
export const createAgent = async (payload) => {
  const res = await api.post("/commission/agents", payload);
  return res.data;
};
export const updateAgent = async (id, payload) => {
  const res = await api.put(`/commission/agents/${id}`, payload);
  return res.data;
};
export const deleteAgent = async (id) => {
  await api.delete(`/commission/agents/${id}`);
};

export const getCommissionRecords = async (params = {}) => {
  const res = await api.get("/commission/records", { params });
  return res.data ?? [];
};
export const createCommissionRecord = async (payload) => {
  const res = await api.post("/commission/records", payload);
  return res.data;
};
export const updateCommissionRecord = async (id, payload) => {
  const res = await api.put(`/commission/records/${id}`, payload);
  return res.data;
};
export const deleteCommissionRecord = async (id) => {
  await api.delete(`/commission/records/${id}`);
};

export const getCommissionMonthlySummary = async (params = {}) => {
  const res = await api.get("/commission/agents/summary", { params });
  return res.data ?? [];
};

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const getExpenses = async (params = {}) => {
  const res = await api.get("/expenses", { params });
  return res.data ?? [];
};
export const getExpenseSummary = async (params = {}) => {
  const res = await api.get("/expenses/summary", { params });
  return res.data ?? {};
};
export const createExpense = async (payload) => {
  const res = await api.post("/expenses", payload);
  return res.data;
};
export const updateExpense = async (id, payload) => {
  const res = await api.put(`/expenses/${id}`, payload);
  return res.data;
};
export const deleteExpense = async (id) => {
  await api.delete(`/expenses/${id}`);
};

// ═══ HOTEL ════════════════════════════════════════════════════════════════════

// Room types
export const getRoomTypes = async (params = {}) => {
  const res = await api.get("/hotel/room-types", { params });
  return res.data ?? [];
};
export const createRoomType = async (payload) => {
  const res = await api.post("/hotel/room-types", payload);
  return res.data;
};
export const updateRoomType = async (id, payload) => {
  const res = await api.put(`/hotel/room-types/${id}`, payload);
  return res.data;
};
export const deleteRoomType = async (id) => {
  await api.delete(`/hotel/room-types/${id}`);
};

// Rooms
export const getRooms = async (params = {}) => {
  const res = await api.get("/hotel/rooms", { params });
  return res.data ?? [];
};
export const createRoom = async (payload) => {
  const res = await api.post("/hotel/rooms", payload);
  return res.data;
};
export const updateRoom = async (id, payload) => {
  const res = await api.put(`/hotel/rooms/${id}`, payload);
  return res.data;
};
export const deleteRoom = async (id) => {
  await api.delete(`/hotel/rooms/${id}`);
};

// Stay policy — check-in / check-out times and what a late departure costs
export const getStayPolicy = async () => {
  const res = await api.get("/hotel/policy");
  return res.data;
};
export const updateStayPolicy = async (payload) => {
  const res = await api.put("/hotel/policy", payload);
  return res.data;
};

// Meal plans
export const getMealPlans = async (params = {}) => {
  const res = await api.get("/hotel/meal-plans", { params });
  return res.data ?? [];
};
export const createMealPlan = async (payload) => {
  const res = await api.post("/hotel/meal-plans", payload);
  return res.data;
};
export const updateMealPlan = async (id, payload) => {
  const res = await api.put(`/hotel/meal-plans/${id}`, payload);
  return res.data;
};

// Guests
export const getGuests = async (params = {}) => {
  const res = await api.get("/hotel/guests", { params });
  return res.data ?? [];
};
export const createGuest = async (payload) => {
  const res = await api.post("/hotel/guests", payload);
  return res.data;
};
export const updateGuest = async (id, payload) => {
  const res = await api.put(`/hotel/guests/${id}`, payload);
  return res.data;
};

// Front desk
export const getHotelDashboard = async (params = {}) => {
  const res = await api.get("/hotel/dashboard", { params });
  return res.data ?? {};
};
export const getAvailability = async (params = {}) => {
  const res = await api.get("/hotel/availability", { params });
  return res.data ?? {};
};

// Bookings
export const getBookings = async (params = {}) => {
  const res = await api.get("/hotel/bookings", { params });
  return res.data ?? [];
};
export const getBookingById = async (id) => {
  const res = await api.get(`/hotel/bookings/${id}`);
  return res.data;
};
export const createBooking = async (payload) => {
  const res = await api.post("/hotel/bookings", payload);
  return res.data;
};
export const updateBooking = async (id, payload) => {
  const res = await api.put(`/hotel/bookings/${id}`, payload);
  return res.data;
};
export const cancelBooking = async (id, reason) => {
  const res = await api.post(`/hotel/bookings/${id}/cancel`, { reason });
  return res.data;
};
export const checkInBooking = async (id, payload = {}) => {
  const res = await api.post(`/hotel/bookings/${id}/check-in`, payload);
  return res.data;
};
export const checkOutBooking = async (id, payload = {}) => {
  const res = await api.post(`/hotel/bookings/${id}/check-out`, payload);
  return res.data;
};
export const getBookingConfirmation = async (id) => {
  const res = await api.get(`/hotel/bookings/${id}/confirmation`);
  return res.data;
};

// Folio & payments
export const getBookingFolio = async (id) => {
  const res = await api.get(`/hotel/bookings/${id}/folio`);
  return res.data;
};
export const postFolioItem = async (id, payload) => {
  const res = await api.post(`/hotel/bookings/${id}/folio/items`, payload);
  return res.data;
};
export const deleteFolioItem = async (id, itemId) => {
  await api.delete(`/hotel/bookings/${id}/folio/items/${itemId}`);
};
export const addBookingPayment = async (id, payload) => {
  const res = await api.post(`/hotel/bookings/${id}/payments`, payload);
  return res.data;
};

// Front desk — room rack, guest trace, room service
export const getRoomGrid = async (params = {}) => {
  const res = await api.get("/hotel/room-grid", { params });
  return res.data ?? { rooms: [], counts: {} };
};
export const getGuestHistory = async (id) => {
  const res = await api.get(`/hotel/guests/${id}/history`);
  return res.data;
};
export const getGuestDirectory = async (params = {}) => {
  const res = await api.get("/hotel/guest-directory", { params });
  return res.data ?? [];
};
export const createRoomServiceOrder = async (payload) => {
  const res = await api.post("/hotel/room-service", payload);
  return res.data;
};

// ─── Owner reports ────────────────────────────────────────────────────────────
export const getReportSummary = async (params = {}) => {
  const res = await api.get("/reports/summary", { params });
  return res.data ?? {};
};
export const getReportTransactions = async (params = {}) => {
  const res = await api.get("/reports/transactions", { params });
  return res.data ?? { transactions: [], totals: {} };
};
































// import axios from "axios";

// const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// const api = axios.create({
//   baseURL: BASE_URL,
// });

// export const getBranches = async () => {
//   const response = await api.get("/branches");
//   return response.data;
// };

// export const getUsers = async () => {
//   const response = await axios.get(`${BASE_URL}/users`);
//   return response.data;
// };

// export const getRoles = async () => {
//   const response = await axios.get(`${BASE_URL}/roles`);
//   return response.data;
// };

// export const getUserById = async (userId) => {
//   const response = await axios.get(`${BASE_URL}/users/${userId}`);
//   return response.data;
// };

// export const updateUser = async (id, payload) => {
//   const response = await axios.put(`${BASE_URL}/users/${id}`, payload);
//   return response.data;
// };

// export const getBranchById = async (branchId) => {
//   const response = await axios.get(`${BASE_URL}/branches/${branchId}`);
//   return response.data;
// };

// export const deleteBranchById = async (branchId) => {
//   await axios.delete(`${BASE_URL}/branches/${branchId}`);
// };

// // 1. Create User
// export const createUser = async (userData) => {
//   const res = await axios.post(`${BASE_URL}/users`, userData);
//   return res.data; // This returns { u_id, ... }
// };

// export const deleteUserById = async (userId) => {
//   await axios.delete(`${BASE_URL}/users/${userId}`);
// };

// // 2. Create Branch
// export const createBranch = async (branchData) => {
//   const res = await axios.post(`${BASE_URL}/branches`, branchData);
//   return res.data;
// };

// /**
//  * LOGIC: ORCHESTRATOR
//  * This function handles the two-step logic required by your backend
//  */
// export const setupBranchWithManager = async (combinedData) => {
//   try {
//     // Step A: Create the User first
//     const newUser = await createUser(combinedData.manager);
    
//     // Step B: Use the returned u_id to create the Branch
//     const branchPayload = {
//       ...combinedData.branch,
//       U_id: newUser.u_id, // Linking the ID from step A
//       com_id: 1 // Assuming a default com_id or pass it from your Auth context
//     };

//     const newBranch = await createBranch(branchPayload);
    
//     return { user: newUser, branch: newBranch };
//   } catch (error) {
//     // If step A succeeds but step B fails, you might want to handle user deletion 
//     // or notify the admin. For now, we throw the error to the UI.
//     throw error;
//   }
// };

























// ─── Activity log ─────────────────────────────────────────────────────────────
export const getActivity = async (params = {}) => {
  const res = await api.get("/activity", { params });
  return res.data ?? { entries: [], next_cursor: null };
};
export const getActivitySummary = async (params = {}) => {
  const res = await api.get("/activity/summary", { params });
  return res.data ?? {};
};

/* ── The cash drawer ─────────────────────────────────────────────────────────
 * A shift at the till: opened with a counted float, closed with a physical
 * count. `getCashSession` is what the POS asks on load to know whether to
 * prompt for a float.
 */
export const getCashSession = async (b_id) => {
  const res = await api.get("/cash/session", { params: { b_id } });
  return res.data;
};

export const openCashSession = async (payload) => {
  const res = await api.post("/cash/session/open", payload);
  return res.data;
};

export const addCashMovement = async (payload) => {
  const res = await api.post("/cash/session/movement", payload);
  return res.data;
};

/**
 * Close the shift. `counted_cash` is required — the expected figure comes back
 * in the response, never before, so the count is a real count.
 */
export const closeCashSession = async (payload) => {
  const res = await api.post("/cash/session/close", payload);
  return res.data;
};

export const getCashSessions = async (params) => {
  const res = await api.get("/cash/sessions", { params });
  return res.data;
};

export const getCashSessionById = async (id) => {
  const res = await api.get(`/cash/sessions/${id}`);
  return res.data;
};
