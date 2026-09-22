import express from "express";
const router = express.Router();

/**
 * Promotions / Discount module — DISABLED
 *
 * The module is incomplete (coupon codes are never redeemed at the POS)
 * and is intentionally hidden from the UI. All routes return 410 Gone so
 * any stale bookmark or direct API call gets a clear, logged rejection
 * rather than silently succeeding or crashing.
 *
 * The order-level discount_pct used at the cashier till is handled entirely
 * inside orderController.js and does NOT go through these routes — the till
 * continues to work normally.
 *
 * To re-enable: restore the original discountRoutes.js from git history.
 */
const disabled = (_req, res) =>
  res.status(410).json({
    success: false,
    message: "The Promotions module is currently disabled.",
  });

router.get("/", disabled);
router.get("/active/today", disabled);
router.get("/stats/summary", disabled);
router.get("/validate/:coupon_code", disabled);
router.get("/:id", disabled);
router.post("/", disabled);
router.post("/apply", disabled);
router.post("/combo/check", disabled);
router.post("/:id/redeem", disabled);
router.put("/:id", disabled);
router.patch("/:id", disabled);
router.patch("/:id/toggle", disabled);
router.delete("/:id", disabled);

export default router;
