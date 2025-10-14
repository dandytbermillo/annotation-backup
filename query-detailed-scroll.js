const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
});

(async () => {
  try {
    // Get the most recent drag session
    const result = await pool.query(`
      SELECT
        component,
        action,
        metadata,
        to_char(created_at, 'HH24:MI:SS.MS') as time
      FROM debug_logs
      WHERE action IN (
        'drag_start',
        'auto_scroll_EXECUTING',
        'drag_end',
        'panCameraBy_dispatch'
      )
      AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at ASC
      LIMIT 50
    `);

    console.log('\n=== DETAILED AUTO-SCROLL EXECUTION (Last drag session) ===\n');
    console.log(`Found ${result.rows.length} events\n`);

    let dragSessionActive = false;
    let scrollCount = 0;

    result.rows.forEach((row, i) => {
      const m = row.metadata;

      if (row.action === 'drag_start') {
        dragSessionActive = true;
        scrollCount = 0;
        console.log(`\n🎯 DRAG STARTED at [${row.time}]`);
        console.log(`   Panel: ${m.panelId}`);
        console.log(`   Initial Canvas: translateX=${m.canvasState.translateX}, translateY=${m.canvasState.translateY}`);
        console.log('');
      }

      if (row.action === 'auto_scroll_EXECUTING' && dragSessionActive) {
        scrollCount++;
        if (scrollCount <= 5 || scrollCount % 10 === 0) { // Show first 5 and every 10th
          console.log(`   📜 Scroll #${scrollCount} at [${row.time}]`);
          console.log(`      Scroll Delta: x=${m.scrollDelta.x}, y=${m.scrollDelta.y}`);
          console.log(`      Canvas BEFORE: translateX=${m.canvasState.translateX}, translateY=${m.canvasState.translateY}`);
          console.log(`      Method: ${m.scrollMethod}`);
        }
      }

      if (row.action === 'panCameraBy_dispatch' && dragSessionActive) {
        console.log(`   🎥 Camera Pan at [${row.time}]`);
        console.log(`      Screen Delta: dx=${m.screenDelta.dx}, dy=${m.screenDelta.dy}`);
        console.log(`      World Delta: dx=${m.worldDelta.dx}, dy=${m.worldDelta.dy}`);
        console.log(`      Old Position: x=${m.oldPosition.x}, y=${m.oldPosition.y}`);
        console.log(`      New Position: x=${m.newPosition.x}, y=${m.newPosition.y}`);
        console.log(`      DISPATCHED: translateX=${m.payload.translateX}, translateY=${m.payload.translateY}`);
        console.log('');
      }

      if (row.action === 'drag_end' && dragSessionActive) {
        console.log(`\n🏁 DRAG ENDED at [${row.time}]`);
        console.log(`   Total scrolls: ${scrollCount}`);
        console.log('');
        dragSessionActive = false;
      }
    });

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
