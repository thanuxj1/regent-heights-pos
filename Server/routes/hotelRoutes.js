import { Router } from "express";
import {
  requireAuth, requireBranchAdminOr, CAPABILITIES, requireCashierOrAbove,
} from "../middleware/authMiddleware.js";
import {
  getRoomTypes, getRoomTypeById, createRoomType, updateRoomType, deleteRoomType,
  getRoomFacilities, createRoomFacility, deleteRoomFacility,
  getRooms, createRoom, updateRoom, deleteRoom,
} from "../controllers/roomController.js";
import {
  getGuests, getGuestById, createGuest, updateGuest,
  getAvailability, getBookings, getBookingById, createBooking, updateBooking, cancelBooking,
  checkIn, checkOut, getFolio, postFolioItem, deleteFolioItem, addPayment,
  getDashboard, getConfirmation, getStayPolicy, updateStayPolicy,
} from "../controllers/bookingController.js";
import {
  getRoomGrid, getGuestHistory, getGuestDirectory, createRoomServiceOrder, chargeOrderToRoom,
} from "../controllers/frontDeskController.js";
import {
  getMealPlans, createMealPlan, updateMealPlan, getMealPlanStats,
} from "../controllers/mealPlanController.js";

const router = Router();

/**
 * Everything here is the front desk's work, and some of it is the owner's alone.
 *
 * The whole module used to sit behind requireAuth and nothing else, which meant
 * a kitchen account could cancel a booking, take a payment, or delete a room
 * type. Reads are front-desk-and-above too: bookings and guest records carry
 * passport numbers and phone numbers that the kitchen has no reason to hold.
 *
 * Nothing on the waiter or kitchen screens calls this module, so none of them
 * lose a feature to these guards.
 */
router.use(requireAuth, requireCashierOrAbove);

// ─── Property setup — the owner defines it, everyone else reads it ───────────
router.get("/room-types",        getRoomTypes);
router.get("/room-types/:id",    getRoomTypeById);
router.post("/room-types",       requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), createRoomType);
router.put("/room-types/:id",    requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), updateRoomType);
router.delete("/room-types/:id", requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), deleteRoomType);

// The facilities a room type can be ticked with: the property's own list.
router.get("/room-facilities",        getRoomFacilities);
router.post("/room-facilities",       requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), createRoomFacility);
router.delete("/room-facilities/:id", requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), deleteRoomFacility);

// Meal plan categories (RO/BB/HB/FB, or whatever a property adds) — a
// front-desk user reads this to offer a choice at check-in; only a
// manager defines what the choices are and what they cost.
router.get("/meal-plans",           getMealPlans);
router.get("/meal-plans/:id/stats", getMealPlanStats);
router.post("/meal-plans",          requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), createMealPlan);
router.put("/meal-plans/:id",       requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), updateMealPlan);

router.get("/rooms",        getRooms);
router.post("/rooms",       requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), createRoom);
router.put("/rooms/:id",    updateRoom);        // housekeeping status is front-desk work
router.delete("/rooms/:id", requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), deleteRoom);

// House rules decide what guests are charged, so only the owner may change them.
router.get("/policy",       getStayPolicy);
router.put("/policy",       requireBranchAdminOr(CAPABILITIES.HOTEL_MANAGEMENT), updateStayPolicy);

// Meal plan routes removed — meal plan module has been retired.

// ─── Guests ──────────────────────────────────────────────────────────────────
router.get("/guest-directory",    getGuestDirectory);
router.get("/guests",             getGuests);
router.post("/guests",            createGuest);
router.get("/guests/:id/history", getGuestHistory);
router.get("/guests/:id",         getGuestById);
router.put("/guests/:id",         updateGuest);

// ─── Front desk ──────────────────────────────────────────────────────────────
router.get("/dashboard",    getDashboard);
router.get("/availability", getAvailability);
router.get("/room-grid",    getRoomGrid);
router.post("/room-service", createRoomServiceOrder);
// Put an order the kitchen already has on a guest's bill (no second order, no second stock).
router.post("/room-service/charge-order", chargeOrderToRoom);

// ─── Bookings ────────────────────────────────────────────────────────────────
router.get("/bookings",                    getBookings);
router.post("/bookings",                   createBooking);
router.get("/bookings/:id",                getBookingById);
router.put("/bookings/:id",                updateBooking);
router.post("/bookings/:id/cancel",        cancelBooking);
router.post("/bookings/:id/check-in",      checkIn);
router.post("/bookings/:id/check-out",     checkOut);
router.get("/bookings/:id/confirmation",   getConfirmation);

// ─── Folio & payments ────────────────────────────────────────────────────────
router.get("/bookings/:id/folio",                  getFolio);
router.post("/bookings/:id/folio/items",           postFolioItem);
router.delete("/bookings/:id/folio/items/:itemId", deleteFolioItem);
router.post("/bookings/:id/payments",              addPayment);

export default router;
