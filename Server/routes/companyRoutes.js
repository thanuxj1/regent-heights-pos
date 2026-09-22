import express from "express";
import {
  requireAuth,
  requireSuperAdmin,
} from "../middleware/authMiddleware.js";
import {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyImpact,
} from "../controllers/companyController.js";

const router = express.Router();

// 1. Verify identity
router.use(requireAuth);
// 2. Verify Super Admin role
router.use(requireSuperAdmin);

router.get("/", getCompanies);
router.get("/:id", getCompanyById);
router.post("/", createCompany);
router.put("/:id", updateCompany);
router.get("/:id/impact", getCompanyImpact);
router.delete("/:id", deleteCompany);

export default router;
