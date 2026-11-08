import { Router } from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getBankTransactions, createBankTransaction, updateBankTransaction, deleteBankTransaction,
  listBankCategories, createBankCategory, updateBankCategory, deleteBankCategory,
} from "../controllers/bankController.js";

// The bank book, on the Accounting page — the same people who keep the expenses.
const router = Router();
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.REPORTS_ACCOUNTING));

router.get("/categories",        listBankCategories);
router.post("/categories",       createBankCategory);
router.put("/categories/:id",    updateBankCategory);
router.delete("/categories/:id", deleteBankCategory);

router.get("/",       getBankTransactions);
router.post("/",      createBankTransaction);
router.put("/:id",    updateBankTransaction);
router.delete("/:id", deleteBankTransaction);

export default router;
