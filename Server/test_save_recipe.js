import dotenv from 'dotenv';
dotenv.config();
import pool from './config/database.js';

async function run() {
  try {
    await pool.query('DELETE FROM "RECIPE"');
    console.log("Deleted test recipes");
  } catch (err) {
    console.error("Script error:", err);
  } finally {
    process.exit(0);
  }
}
run();
