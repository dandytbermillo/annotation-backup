const { Pool } = require('pg');

async function fix() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'annotation_dev',
    user: 'postgres',
    password: 'postgres'
  });
  
  try {
    // Add to the _migrations table that the script uses
    await pool.query(`
      INSERT INTO _migrations (filename) 
      VALUES ('012_items_tree_structure.up.sql')
      ON CONFLICT (filename) DO NOTHING
    `);
    console.log('✅ Added migration to _migrations table');
    
    // Check status
    const result = await pool.query(`
      SELECT filename FROM _migrations 
      ORDER BY filename
    `);
    console.log('\n📋 Migrations tracked in _migrations table:');
    result.rows.forEach(r => console.log('  •', r.filename));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

fix();