// Load .env from beside this file, not from wherever the process happens to be
// started. `import "dotenv/config"` resolves relative to the working directory,
// so launching the server by absolute path from another folder silently left
// JWT_SECRET and DATABASE_URL unset — every authenticated request then failed
// with a 500 and the cause was invisible.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });
import express from "express";
import cors from "cors";
import { checkConfig, corsOrigin, describeCorsOrigin } from "./config/env.js";
import { createServer } from "http";
import { initializeSocket } from "./utils/socket.js";



// ─────────────────────────────────────────────
// ROUTE IMPORTS
// ─────────────────────────────────────────────

// Auth
import authRoutes from "./routes/authRoutes.js";

// User Management
import userRoutes from "./routes/userRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";

// Company & Branch
import companyRoutes from "./routes/companyRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";

// Customers
import customerRoutes from "./routes/customerRoutes.js";

// Tables
import tableRoutes from "./routes/tableRoutes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { scheduleActivityPrune } from "./utils/activityRetention.js";
import { warmPool } from "./config/database.js";
import tableAssignmentRoutes from "./routes/tableAssignmentRoutes.js";
import reservationRoutes from "./routes/reservationRoutes.js";
import waiterRoutes from "./routes/waiterRoutes.js";

// Products & Categories
import categoryRoutes from "./routes/categoryRoutes.js";
import branchProductRoutes from "./routes/branchProductRoutes.js";
import recipeRoutes from "./routes/recipeRouter.js";

// Raw Materials & Inventory
import rawMaterialRoutes from "./routes/rawMaterialRoutes.js";
import wasteRoutes from "./routes/wasteRoutes.js";

// Suppliers & Purchasing
import supplierRoutes from "./routes/supplierRoutes.js";
import purchaseOrderRoutes from "./routes/purchaseOrderRoutes.js";
import purchaseItemRoutes from "./routes/purchaseItemRoutes.js";
import supplierPaymentRoutes from "./routes/supplierPaymentRoutes.js";

// Orders & Payments
import orderRoutes from "./routes/orderRoutes.js";
import orderItemRoutes from "./routes/orderItemRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import discountRoutes from "./routes/discountRoutes.js";

// Delivery & Terminals
import deliveryRoutes from "./routes/deliveryRoutes.js";
import terminalRoutes from "./routes/terminalRoutes.js";
import productRoutes from "./routes/productRoutes.js";



import statsRoutes from "./routes/statsRoutes.js";
import commissionRoutes from "./routes/commissionRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import hotelRoutes from "./routes/hotelRoutes.js";
import securityRoutes from "./routes/securityRoutes.js";
import cashRoutes from "./routes/cashRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";

// ─────────────────────────────────────────────
// APP INIT
// ─────────────────────────────────────────────
const app = express();

// ─────────────────────────────────────────────
// GLOBAL MIDDLEWARE
// ─────────────────────────────────────────────
// Before anything else asks the database or signs a token.
checkConfig();

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    // Without this the browser asks permission before every single call — an
    // OPTIONS round trip in front of each GET, doubling the requests the till
    // makes and never remembering the answer. Two hours is the ceiling Chrome
    // honours; anything longer is silently capped.
    maxAge: 7200,
  }),
);
// Behind a proxy (nginx, Render, Cloudflare) the socket address is the proxy's,
// so the rate limiter would see every guest as one client. TRUST_PROXY says how
// many hops to trust — leave it unset in development. Never set it to "true"
// blindly: that lets anyone forge X-Forwarded-For and walk past the limiter.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ message: "Server is running!" });
});

// A pulse for whoever is watching the tills: is the server up, and can it still
// reach the database? It needs no sign-in — it says nothing but up or down and
// how long the check took, which is what a monitor needs and no more.
app.get("/api/health", async (req, res) => {
  const started = Date.now();
  try {
    const { default: pool } = await import("./config/database.js");
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      database: "up",
      database_ms: Date.now() - started,
      uptime_s: Math.round(process.uptime()),
    });
  } catch {
    res.status(503).json({
      ok: false,
      database: "down",
      database_ms: Date.now() - started,
      uptime_s: Math.round(process.uptime()),
    });
  }
});

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

// -- Auth
app.use("/api/auth", authRoutes);

// -- User Management
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);

// -- Company & Branch
app.use("/api/companies", companyRoutes);
app.use("/api/branches", branchRoutes);

// -- Customers
app.use("/api/customers", customerRoutes);

// -- Tables
app.use("/api/tables", tableRoutes);
app.use("/api/table-assignments", tableAssignmentRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/waiter", waiterRoutes);

// -- Products & Categories
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/branch_products", branchProductRoutes);
app.use("/api/recipes", recipeRoutes);

// -- Raw Materials & Inventory
app.use("/api/raw-materials", rawMaterialRoutes);
app.use("/api/waste", wasteRoutes);

// -- Suppliers & Purchasing
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/purchase-items", purchaseItemRoutes);
app.use("/api/supplier-payments", supplierPaymentRoutes);

// -- Orders & Payments
app.use("/api/orders", orderRoutes);
app.use("/api/order-items", orderItemRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/discounts", discountRoutes);

// -- Delivery & Terminals
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/terminals", terminalRoutes);


// Stats
app.use("/api/stats", statsRoutes);
app.use("/api/commission", commissionRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/hotel", hotelRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/activity", activityRoutes);

// ─────────────────────────────────────────────
// ERROR HANDLING (must be last)
// ─────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─────────────────────────────────────────────
// STAYING UP
// ─────────────────────────────────────────────
/*
 * Express 4 does not catch a rejection from an async route handler, and Node
 * treats an unhandled rejection as fatal. Two dozen places in this codebase do
 *
 *     const client = await pool.connect();   // outside any try
 *
 * so a momentary database hiccup does not fail one request — it kills the whole
 * server. That happened twice while this was being built, and in a hotel it
 * means the till stops mid-service until somebody notices and restarts it.
 *
 * Nothing here supervises the process, so exiting is not "fail fast", it is
 * "stay down". Logging loudly and continuing to serve is the better trade: the
 * request that failed still fails, and the other fifty guests are unaffected.
 *
 * These are a safety net, not a licence to stop handling errors. Anything that
 * lands here is a real bug and the log line is meant to be found and fixed.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[fatal-guard] unhandled promise rejection — request failed, server continuing");
  console.error(reason instanceof Error ? reason.stack : reason);
});

process.on("uncaughtException", (err) => {
  console.error("[fatal-guard] uncaught exception — server continuing");
  console.error(err?.stack || err);
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// Create HTTP server and initialize Socket.IO
const httpServer = createServer(app);
initializeSocket(httpServer);

httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  console.log(`[cors] browser callers allowed: ${describeCorsOrigin()}`);

  // Open the database connections now rather than making the first cashier of
  // the day wait for them. A warm request is ~94ms; five arriving on a cold
  // pool took 918ms, nearly all of it spent opening connections.
  const warm = await warmPool();
  console.log(warm.ok
    ? `[db] ${warm.opened} connections ready in ${warm.ms}ms`
    : `[db] warm-up incomplete (${warm.opened} ready): ${warm.error}`);

  // Housekeeping, not request work: trims the activity log on a daily timer.
  scheduleActivityPrune();

  // One Super Admin is one forgotten password away from nobody being able to
  // administer the platform: an Administrator cannot see that account, let
  // alone reset it. Said at boot because the person who can fix it in one
  // command is the person reading this line.
  try {
    const { default: pool } = await import("./config/database.js");
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "User" WHERE role_id = 6 AND u_status = TRUE`);
    if (rows[0].n < 2) {
      if (rows[0].n === 0) {
        console.warn("[access] No Super Admin can sign in.");
      } else {
        console.warn("[access] Only one Super Admin can sign in. Lose that password and only");
        console.warn("         the server console can let anyone back in.");
      }
      console.warn("         Make another: node scripts/create-super-admin.js <email>");
    }
  } catch { /* never hold up the server for advice */ }
});


// app.use("/api/stats", statsRoutes);