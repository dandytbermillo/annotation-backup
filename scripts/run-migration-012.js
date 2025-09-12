const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'annotation_dev',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    console.log('🚀 Running Phase 1 migration: items table...');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'migrations', '012_items_tree_structure.up.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    
    // Run migration
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify migration
    console.log('\n📊 Verifying migration...');
    const result = await pool.query('SELECT * FROM verify_migration()');
    
    console.table(result.rows);
    
    // Check items table
    const itemsCount = await pool.query('SELECT COUNT(*) FROM items');
    console.log(`\n📁 Total items in table: ${itemsCount.rows[0].count}`);
    
    // Check root folders
    const roots = await pool.query("SELECT type, path, name FROM items WHERE parent_id IS NULL ORDER BY position");
    console.log('\n📂 Root folders:');
    console.table(roots.rows);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();