import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  getExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense
} from "../controllers/expenseController.js";

const router = Router();
router.use(requireAuth);

router.get("/",        getExpenses);
router.get("/summary", getExpenseSummary);
router.post("/",       createExpense);
router.put("/:id",     updateExpense);
router.delete("/:id",  deleteExpense);

export default router;
