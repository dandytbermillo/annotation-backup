const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== CHECKING FOR POSITION UPDATES (Last 30 events) ===\n');

  // Find any logs that indicate positions are being CHANGED (not just read)
  const res = await client.query(`
    SELECT
      component,
      action,
      metadata,
      created_at
    FROM debug_logs
    WHERE
      component IN ('AnnotationCanvas', 'AnnotationApp')
      AND (
        action LIKE '%position_update%'
        OR action LIKE '%POSITION%'
        OR action LIKE '%workspace_seed%'
        OR action LIKE '%CANVAS_POSITION_UPDATED%'
        OR action = 'setCanvasItems_called'
      )
    ORDER BY created_at DESC
    LIMIT 30
  `);

  console.log(`Found ${res.rows.length} position-related events:\n`);

  res.rows.forEach((row, idx) => {
    const timestamp = new Date(row.created_at).toISOString();
    console.log(`[${idx + 1}] ${timestamp}`);
    console.log(`    Component: ${row.component}`);
    console.log(`    Action: ${row.action}`);

    // Highlight important metadata
    if (row.metadata) {
      const meta = row.metadata;

      if (meta.mainPosition) {
        console.log(`    Main Position: (${meta.mainPosition.x}, ${meta.mainPosition.y})`);
      }

      if (meta.mainPanelPositions) {
        console.log(`    Panel Positions:`, meta.mainPanelPositions);
      }

      if (meta.workspaceMainPosition) {
        console.log(`    Workspace Position: (${meta.workspaceMainPosition.x}, ${meta.workspaceMainPosition.y})`);
      }

      if (meta.reason) {
        console.log(`    Reason: ${meta.reason}`);
      }

      console.log(`    Full Metadata:`, JSON.stringify(meta, null, 2));
    }
    console.log('');
  });

  // Also check the actual database for recent position changes
  console.log('\n=== RECENT PANEL POSITION CHANGES IN DATABASE ===\n');

  const dbChanges = await client.query(`
    SELECT
      panel_id,
      note_id,
      position_x_world,
      position_y_world,
      updated_at
    FROM panels
    WHERE panel_id = 'main'
    ORDER BY updated_at DESC
    LIMIT 10
  `);

  console.log(`Last ${dbChanges.rows.length} database updates:\n`);

  dbChanges.rows.forEach((row, idx) => {
    console.log(`[${idx + 1}] Note: ${row.note_id.substring(0, 8)}...`);
    console.log(`    Position: (${row.position_x_world}, ${row.position_y_world})`);
    console.log(`    Updated: ${new Date(row.updated_at).toISOString()}`);
    console.log('');
  });

  await client.end();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
