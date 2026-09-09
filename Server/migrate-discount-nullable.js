import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pkg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const migrate = async () => {
  try {
    await pool.query(`ALTER TABLE discount ALTER COLUMN "Bpro_id" DROP NOT NULL`);
    console.log("✓ Bpro_id is now nullable — order/loyalty discounts no longer require a branch product.");
  } catch (err) {
    if (err.code === "42703" || err.message.includes("does not exist")) {
      console.log("Column Bpro_id not found — already nullable or table missing.");
    } else if (err.message.includes("already")) {
      console.log("Already nullable, no change needed.");
    } else {
      console.error("Migration error:", err.message);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
};

migrate();
