import express from "express";
import { login } from "../controllers/authController.js";
import { loginIpLimiter, loginEmailLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// Both limiters count failures only, so a normal sign-in never touches them.
router.post("/login", loginIpLimiter, loginEmailLimiter, login);

export default router;
