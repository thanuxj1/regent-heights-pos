import express from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/userController.js";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";

const router = express.Router();

// All user routes require auth + Branch Admin/Admin, or a cashier granted the
// User Management capability. Granting/revoking capabilities themselves is a
// separate, stricter router (userCapabilityRoutes.js) that never delegates.
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.USER_MANAGEMENT));

router.get("/", getUsers);
router.get("/:id", getUserById);
router.post("/", createUser);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
