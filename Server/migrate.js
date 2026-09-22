import pool from './config/database.js';

async function migrate() {
  try {
    console.log('Adding yield_unit and yield_amount to Raw_Material...');
    await pool.query(`
      ALTER TABLE "Raw_Material" 
      ADD COLUMN IF NOT EXISTS yield_unit VARCHAR(20), 
      ADD COLUMN IF NOT EXISTS yield_amount NUMERIC;
    `);
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
