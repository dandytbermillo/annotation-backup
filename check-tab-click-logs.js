const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== TAB CLICK DEBUG LOGS (Last 50 events) ===\n');

  // Get all relevant logs for tab clicks and panel movements
  const res = await client.query(`
    SELECT
      component,
      action,
      metadata,
      created_at
    FROM debug_logs
    WHERE
      component IN ('AnnotationCanvas', 'AnnotationApp', 'CanvasPanel')
      AND (
        action LIKE '%centerOnPanel%'
        OR action LIKE '%setCanvasItems%'
        OR action LIKE '%viewport%'
        OR action LIKE '%panel_position%'
        OR action LIKE '%noteIds_sync%'
        OR action LIKE '%workspace_seed%'
      )
    ORDER BY created_at DESC
    LIMIT 50
  `);

  console.log(`Found ${res.rows.length} log entries:\n`);

  res.rows.forEach((row, idx) => {
    const timestamp = new Date(row.created_at).toISOString();
    console.log(`[${idx + 1}] ${timestamp}`);
    console.log(`    Component: ${row.component}`);
    console.log(`    Action: ${row.action}`);
    console.log(`    Metadata:`, JSON.stringify(row.metadata, null, 2));
    console.log('');
  });

  await client.end();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
