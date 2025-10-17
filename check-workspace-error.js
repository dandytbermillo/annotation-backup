const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== RECENT WORKSPACE PERSIST ATTEMPTS ===\n');

  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'CanvasWorkspace'
      AND action IN ('persist_attempt', 'persist_failed', 'persist_error')
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  res.rows.forEach((row, idx) => {
    console.log(`\n[Entry ${idx + 1}] ${row.action} at ${row.created_at.toISOString()}`);
    console.log(JSON.stringify(row.metadata, null, 2));
  });

  await client.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
