#!/usr/bin/env node

/**
 * Debug script to check if editor content is being deleted when switching notes
 */

const { Pool } = require('pg');

// PostgreSQL connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'annotation_system',
});

async function checkEditorContent() {
  try {
    console.log('Checking editor content in PostgreSQL...\n');

    // Check yjs_updates table for editor content
    const updatesResult = await pool.query(`
      SELECT doc_name, pg_size_pretty(length(update)::bigint) as size, timestamp 
      FROM yjs_updates 
      WHERE doc_name LIKE '%panel%'
      ORDER BY timestamp DESC 
      LIMIT 20
    `);

    console.log('Recent editor updates:');
    console.log('---------------------');
    if (updatesResult.rows.length === 0) {
      console.log('No editor updates found');
    } else {
      updatesResult.rows.forEach(row => {
        console.log(`${row.doc_name} - ${row.size} - ${row.timestamp}`);
      });
    }

    // Check snapshots table
    const snapshotsResult = await pool.query(`
      SELECT doc_name, pg_size_pretty(length(state)::bigint) as size, created_at 
      FROM snapshots 
      WHERE doc_name LIKE '%panel%'
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log('\nEditor snapshots:');
    console.log('-----------------');
    if (snapshotsResult.rows.length === 0) {
      console.log('No editor snapshots found');
    } else {
      snapshotsResult.rows.forEach(row => {
        console.log(`${row.doc_name} - ${row.size} - ${row.created_at}`);
      });
    }

    // Check for specific patterns
    console.log('\nChecking for deletion patterns...');
    
    // Look for updates that might indicate clearing
    const smallUpdatesResult = await pool.query(`
      SELECT doc_name, length(update) as size, timestamp 
      FROM yjs_updates 
      WHERE doc_name LIKE '%panel%' AND length(update) < 50
      ORDER BY timestamp DESC 
      LIMIT 10
    `);

    if (smallUpdatesResult.rows.length > 0) {
      console.log('\nFound small updates (possible clear operations):');
      smallUpdatesResult.rows.forEach(row => {
        console.log(`${row.doc_name} - ${row.size} bytes - ${row.timestamp}`);
      });
    }

  } catch (error) {
    console.error('Error checking editor content:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkEditorContent();