const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  });

  await client.connect();

  console.log('\n=== CHECKING canvas_workspace_notes TABLE ===\n');

  // Check if table exists
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'canvas_workspace_notes'
    );
  `);

  const tableExists = tableCheck.rows[0].exists;
  console.log(`Table canvas_workspace_notes exists: ${tableExists}`);

  if (tableExists) {
    // Get table structure
    const structure = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'canvas_workspace_notes'
      ORDER BY ordinal_position;
    `);

    console.log('\nTable structure:');
    structure.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });

    // Count rows
    const countRes = await client.query('SELECT COUNT(*) FROM canvas_workspace_notes');
    console.log(`\nTotal rows: ${countRes.rows[0].count}`);

    // Show sample data
    const sampleRes = await client.query('SELECT * FROM canvas_workspace_notes LIMIT 5');
    console.log('\nSample data:');
    console.log(JSON.stringify(sampleRes.rows, null, 2));
  }

  await client.end();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
