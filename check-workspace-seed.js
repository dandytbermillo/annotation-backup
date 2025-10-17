const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== workspaceSeedAppliedRef EFFECT TRIGGERS ===\n');

  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'AnnotationCanvas'
      AND action IN (
        'workspaceSeedAppliedRef_effect_triggered',
        'WORKSPACE_SEED_SKIPPED_PANEL_EXISTS',
        'WORKSPACE_SEED_UPDATING_POSITION'
      )
      AND created_at > NOW() - INTERVAL '10 minutes'
    ORDER BY created_at DESC
    LIMIT 30
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
