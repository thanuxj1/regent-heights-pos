import { Router } from "express";
import { requireAuth, requireBranchAdminOrAdmin } from "../middleware/authMiddleware.js";
import {
  getExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense
} from "../controllers/expenseController.js";

const router = Router();
// The owner's books — salaries, bills, what the place costs to run. Any
// signed-in user could read every line and delete the owner's entries; a
// waiter did exactly that in testing. Cash paid out of the till still reaches
// these accounts, through the drawer rather than through this route.
router.use(requireAuth, requireBranchAdminOrAdmin);

router.get("/",        getExpenses);
router.get("/summary", getExpenseSummary);
router.post("/",       createExpense);
router.put("/:id",     updateExpense);
router.delete("/:id",  deleteExpense);

export default router;
