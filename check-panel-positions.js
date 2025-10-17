const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== PANEL POSITIONS FOR ALL NOTES ===\n');

  // Get all panels with their positions
  const res = await client.query(`
    SELECT
      panel_id,
      note_id,
      type,
      position_x_world,
      position_y_world,
      created_at,
      updated_at
    FROM panels
    WHERE panel_id = 'main'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  console.log('Found', res.rows.length, 'main panels:\n');
  res.rows.forEach((row, idx) => {
    console.log(`[${idx + 1}] Note: ${row.note_id}`);
    console.log(`    Position: (${row.position_x_world}, ${row.position_y_world})`);
    console.log(`    Created: ${row.created_at.toISOString()}`);
    console.log('');
  });

  console.log('\n=== WORKSPACE POSITIONS ===\n');

  const ws = await client.query(`
    SELECT
      note_id,
      main_position_x,
      main_position_y,
      is_open,
      updated_at
    FROM canvas_workspace_notes
    WHERE is_open = TRUE
    ORDER BY updated_at DESC
    LIMIT 10
  `);

  console.log('Found', ws.rows.length, 'open notes in workspace:\n');
  ws.rows.forEach((row, idx) => {
    console.log(`[${idx + 1}] Note: ${row.note_id}`);
    console.log(`    Position: (${row.main_position_x}, ${row.main_position_y})`);
    console.log(`    Updated: ${row.updated_at.toISOString()}`);
    console.log('');
  });

  await client.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
