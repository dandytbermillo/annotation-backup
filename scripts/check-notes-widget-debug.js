#!/usr/bin/env node
/**
 * Query debug logs for notes widget investigation
 * Run: node scripts/check-notes-widget-debug.js
 */

const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Query recent AnnotationApp logs
    const res = await client.query(`
      SELECT
        id,
        component,
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'AnnotationApp'
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC
      LIMIT 50
    `);

    console.log('='.repeat(80));
    console.log('NOTES WIDGET DEBUG LOGS (last 10 minutes)');
    console.log('='.repeat(80));
    console.log('');

    if (res.rows.length === 0) {
      console.log('No logs found. Make sure:');
      console.log('  1. The app is running (npm run dev)');
      console.log('  2. You clicked the "EMERGENCY TEST" button');
      console.log('  3. Migrations are up to date');
      console.log('');
    } else {
      res.rows.forEach((row, idx) => {
        console.log(`[${idx + 1}] ${row.created_at.toISOString()}`);
        console.log(`    Component: ${row.component}`);
        console.log(`    Action: ${row.action}`);
        console.log(`    Metadata:`, JSON.stringify(row.metadata, null, 2));
        console.log('');
      });

      console.log('='.repeat(80));
      console.log(`Total logs: ${res.rows.length}`);
      console.log('='.repeat(80));
    }

    await client.end();
  } catch (err) {
    console.error('Error querying debug logs:', err.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  - Ensure Postgres is running: docker compose up -d postgres');
    console.error('  - Verify database exists: psql -U postgres -l');
    console.error('  - Run migrations: npm run migrate:up');
    console.error('');
    process.exit(1);
  }
})();