import pool from './Server/config/db.js';

async function run() {
  try {
    const rm = await pool.query(`SELECT * FROM "Raw_Material" WHERE LOWER(rm_name) = 'carrot'`);
    console.log("Raw materials named carrot:", rm.rows);

    const bp = await pool.query(`SELECT "Bpro_id", pro_name FROM "Branch_Product" WHERE LOWER(pro_name) LIKE '%kottu%'`);
    console.log("Branch Products Kottu:", bp.rows);
    
    if (bp.rows.length > 0) {
       const recipe = await pool.query(`
         SELECT r.*, rm.rm_name, rm.b_id as rm_b_id 
         FROM "RECIPE" r 
         JOIN "Raw_Material" rm ON r."rawmaterial_ID" = rm.rm_id 
         JOIN "Branch_Product" bp ON bp.pro_id = r.pro_id 
         WHERE bp."Bpro_id" = $1
       `, [bp.rows[0].Bpro_id]);
       console.log("Recipe for kottu:", recipe.rows);
    }
    
    const stockMove = await pool.query(`SELECT * FROM "STOCK_MOVEMENT" ORDER BY created_at DESC LIMIT 5`);
    console.log("Recent stock movements:", stockMove.rows);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
