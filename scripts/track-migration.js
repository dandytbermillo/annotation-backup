const { Pool } = require('pg');

async function trackMigration() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'annotation_dev',
    user: 'postgres',
    password: 'postgres'
  });
  
  try {
    // Check if migrations tracking table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'migrations'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      // Add our migration to the tracking table
      await pool.query(`
        INSERT INTO migrations (name, applied_at) 
        VALUES ('012_items_tree_structure.up.sql', NOW())
        ON CONFLICT (name) DO NOTHING
      `);
      console.log('✅ Migration tracked in migrations table');
    } else {
      // Create a simple migrations table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          applied_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // Track all existing migrations based on what's in the database
      const migrations = [
        '000_enable_pgcrypto.up.sql',
        '001_initial_schema.up.sql',
        '002_rename_annotations_to_branches.up.sql',
        '003_structured_data_layer.up.sql',
        '004_offline_queue.up.sql',
        '005_document_saves.up.sql',
        '006_plain_branches_columns.up.sql',
        '007_debug_logs.up.sql',
        '007_fix_branches_parent_id_type.up.sql',
        '008_fix_branches_required_columns.up.sql',
        '009_allow_document_saves_in_offline_queue.up.sql',
        '010_document_saves_fts.up.sql',
        '011_offline_queue_reliability.up.sql',
        '012_items_tree_structure.up.sql'
      ];
      
      for (const migration of migrations) {
        await pool.query(`
          INSERT INTO migrations (name) 
          VALUES ($1)
          ON CONFLICT (name) DO NOTHING
        `, [migration]);
      }
      
      console.log('✅ Created migrations table and tracked all migrations');
    }
    
    // Verify
    const result = await pool.query('SELECT * FROM migrations ORDER BY applied_at DESC LIMIT 15');
    console.log('\n📋 Tracked migrations:');
    console.table(result.rows.map(r => ({
      name: r.name,
      applied: new Date(r.applied_at).toLocaleString()
    })));
    
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await pool.end();
  }
}

trackMigration();