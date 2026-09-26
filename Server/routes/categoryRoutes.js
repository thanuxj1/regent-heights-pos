import express from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";

const router = express.Router();

// Protect all category endpoints
router.use(requireAuth);

// Anyone signed in reads the menu structure — the till, the waiter, the kitchen.
router.get("/", getCategories);
router.get("/:id", getCategoryById);

// Changing it is the owner's job. It was open to every signed-in user, so a
// waiter could have deleted a category mid-service.
router.post("/", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), createCategory);
router.put("/:id", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), updateCategory);
router.delete("/:id", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), deleteCategory);

export default router;

