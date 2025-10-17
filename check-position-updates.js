const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== POSITION UPDATE LOGS (Last 30) ===\n');

  // Find logs that actually UPDATE positions (not just read them)
  const res = await client.query(`
    SELECT
      component,
      action,
      metadata,
      created_at
    FROM debug_logs
    WHERE
      component = 'AnnotationCanvas'
      AND (
        action LIKE '%position_update%'
        OR action LIKE '%workspace_seed%'
        OR action LIKE '%main_panel%'
        OR action LIKE '%panel_create%'
        OR action = 'setCanvasItems_called'
      )
    ORDER BY created_at DESC
    LIMIT 30
  `);

  console.log(`Found ${res.rows.length} position update events:\n`);

  res.rows.forEach((row, idx) => {
    const timestamp = new Date(row.created_at).toISOString();
    console.log(`[${idx + 1}] ${timestamp}`);
    console.log(`    Action: ${row.action}`);
    console.log(`    Metadata:`, JSON.stringify(row.metadata, null, 2));
    console.log('');
  });

  await client.end();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
