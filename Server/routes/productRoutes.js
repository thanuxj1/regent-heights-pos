import express from "express";
import {
  requireAuth,
  requireBranchAdminOr,
  requireBranchAdminOrAny,
  CAPABILITIES,
} from "../middleware/authMiddleware.js";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";

const router = express.Router();

// Recording a purchase of goods for resale picks the product from this list, so
// Purchase Orders may read it. Creating or changing a product is the menu's job.
const menu = requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU);
const readable = requireBranchAdminOrAny([CAPABILITIES.PRODUCT_MENU, CAPABILITIES.PURCHASE_ORDERS]);

router.use(requireAuth);

router.get("/", readable, getProducts);
router.get("/:id", readable, getProductById);
router.post("/", menu, createProduct);
router.put("/:id", menu, updateProduct);
router.delete("/:id", menu, deleteProduct);

export default router;
