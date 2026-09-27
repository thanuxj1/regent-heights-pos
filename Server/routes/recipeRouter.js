import express from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getRecipes,
  getRecipeById,
  getRecipesByProduct,
  createRecipe,
  createRecipeBulk,
  replaceRecipeForProduct,
  updateRecipe,
  deleteRecipe,
  deleteRecipeByProduct,
} from "../controllers/recipeController.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU));

// ── Static routes first (before /:id) ────────
router.get("/product/:pro_id", getRecipesByProduct);
router.post("/bulk", createRecipeBulk);
router.put("/product/:pro_id", replaceRecipeForProduct);
router.delete("/product/:pro_id", deleteRecipeByProduct);

// ── Standard CRUD ─────────────────────────────
router.get("/", getRecipes);
router.get("/:id", getRecipeById);
router.post("/", createRecipe);
router.put("/:id", updateRecipe);
router.delete("/:id", deleteRecipe);

export default router;
