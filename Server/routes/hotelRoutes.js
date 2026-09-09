import { Router } from "express";
import {
  requireAuth, requireBranchAdminOrAdmin, requireCashierOrAbove,
} from "../middleware/authMiddleware.js";
import {
  getRoomTypes, getRoomTypeById, createRoomType, updateRoomType, deleteRoomType,
  getRooms, createRoom, updateRoom, deleteRoom,
  getMealPlans, createMealPlan, updateMealPlan, deleteMealPlan,
} from "../controllers/roomController.js";
import {
  getGuests, createGuest, updateGuest,
  getAvailability, getBookings, getBookingById, createBooking, updateBooking, cancelBooking,
  checkIn, checkOut, getFolio, postFolioItem, deleteFolioItem, addPayment,
  getDashboard, getConfirmation, getStayPolicy, updateStayPolicy,
} from "../controllers/bookingController.js";
import {
  getRoomGrid, getGuestHistory, getGuestDirectory, createRoomServiceOrder,
} from "../controllers/frontDeskController.js";

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
router.post("/room-types",       requireBranchAdminOrAdmin, createRoomType);
router.put("/room-types/:id",    requireBranchAdminOrAdmin, updateRoomType);
router.delete("/room-types/:id", requireBranchAdminOrAdmin, deleteRoomType);

router.get("/rooms",        getRooms);
router.post("/rooms",       requireBranchAdminOrAdmin, createRoom);
router.put("/rooms/:id",    updateRoom);        // housekeeping status is front-desk work
router.delete("/rooms/:id", requireBranchAdminOrAdmin, deleteRoom);

// House rules decide what guests are charged, so only the owner may change them.
router.get("/policy",       getStayPolicy);
router.put("/policy",       requireBranchAdminOrAdmin, updateStayPolicy);

router.get("/meal-plans",        getMealPlans);
router.post("/meal-plans",       requireBranchAdminOrAdmin, createMealPlan);
router.put("/meal-plans/:id",    requireBranchAdminOrAdmin, updateMealPlan);
router.delete("/meal-plans/:id", requireBranchAdminOrAdmin, deleteMealPlan);

// ─── Guests ──────────────────────────────────────────────────────────────────
router.get("/guest-directory",    getGuestDirectory);
router.get("/guests",             getGuests);
router.post("/guests",            createGuest);
router.get("/guests/:id/history", getGuestHistory);
router.put("/guests/:id",         updateGuest);

// ─── Front desk ──────────────────────────────────────────────────────────────
router.get("/dashboard",    getDashboard);
router.get("/availability", getAvailability);
router.get("/room-grid",    getRoomGrid);
router.post("/room-service", createRoomServiceOrder);

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
