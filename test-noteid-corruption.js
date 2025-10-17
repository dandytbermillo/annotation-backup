const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== RECENT noteIds_sync EFFECTS ===\n');

  // Get the most recent noteIds_sync effect triggers and updates
  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'AnnotationCanvas'
      AND action IN (
        'noteIds_sync_effect_triggered',
        'noteIds_sync_updated_items',
        'noteIds_sync_NO_CHANGE',
        'noteIds_sync_updating_metadata_only'
      )
      AND created_at > NOW() - INTERVAL '10 minutes'
    ORDER BY created_at DESC
    LIMIT 50
  `);

  res.rows.forEach((row, idx) => {
    console.log(`\n[${idx + 1}] ${row.action} at ${row.created_at.toISOString()}`);
    console.log(JSON.stringify(row.metadata, null, 2));
  });

  console.log('\n\n=== RECENT setCanvasItems CALLS ===\n');

  // Get the recent setCanvasItems calls
  const res2 = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'AnnotationCanvas'
      AND action IN ('setCanvasItems_called', 'setCanvasItems_SKIPPED_SAME_REF')
      AND created_at > NOW() - INTERVAL '10 minutes'
    ORDER BY created_at DESC
    LIMIT 30
  `);

  res2.rows.forEach((row, idx) => {
    console.log(`\n[${idx + 1}] ${row.action} at ${row.created_at.toISOString()}`);
    console.log(JSON.stringify(row.metadata, null, 2));
  });

  await client.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
