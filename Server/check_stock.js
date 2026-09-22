import dotenv from 'dotenv';
dotenv.config();
import pool from './config/database.js';

async function run() {
  try {
    const recipes = await pool.query(`SELECT r.*, p.pro_name, rm.rm_name FROM "RECIPE" r JOIN "Product" p ON p.pro_id = r.pro_id JOIN "Raw_Material" rm ON r."rawmaterial_ID" = rm.rm_id`);
    console.log("All recipes:", recipes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
