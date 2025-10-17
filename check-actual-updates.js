const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== ACTUAL setCanvasItems CALLS (NOT SKIPPED) ===\n');

  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'AnnotationCanvas'
      AND action = 'setCanvasItems_called'
      AND created_at > NOW() - INTERVAL '30 minutes'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  if (res.rows.length === 0) {
    console.log('NO setCanvasItems_called events found in the last 30 minutes!');
    console.log('This means NO state updates happened - the jumping must be visual/CSS, not state-based.');
  } else {
    res.rows.forEach((row, idx) => {
      console.log(`\n[Entry ${idx + 1}] ${row.action} at ${row.created_at.toISOString()}`);
      console.log(JSON.stringify(row.metadata, null, 2));
    });
  }

  console.log('\n\n=== OTHER POSITION-AFFECTING ACTIONS ===\n');

  const res2 = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'AnnotationCanvas'
      AND action IN (
        'WORKSPACE_SEED_UPDATING_POSITION',
        'HYDRATION_ADDING_PANELS',
        'snapshot_restore_complete'
      )
      AND created_at > NOW() - INTERVAL '30 minutes'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  if (res2.rows.length === 0) {
    console.log('NO position-affecting actions found.');
  } else {
    res2.rows.forEach((row, idx) => {
      console.log(`\n[Entry ${idx + 1}] ${row.action} at ${row.created_at.toISOString()}`);
      console.log(JSON.stringify(row.metadata, null, 2));
    });
  }

  await client.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
