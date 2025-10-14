const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
});

(async () => {
  try {
    const result = await pool.query(`
      SELECT
        component,
        action,
        metadata,
        to_char(created_at, 'HH24:MI:SS.MS') as time
      FROM debug_logs
      WHERE action IN (
        'auto_scroll_DELAY_STARTED',
        'auto_scroll_DELAY_CANCELLED',
        'auto_scroll_ACTIVATED',
        'drag_start',
        'drag_end'
      )
      AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 30
    `);

    console.log('\n=== AUTO-SCROLL DELAY LOGS ===\n');
    console.log(`Found ${result.rows.length} events\n`);

    result.rows.forEach((row, i) => {
      const m = row.metadata;
      console.log(`${i + 1}. [${row.time}] ${row.component} → ${row.action}`);

      if (m.panelId) console.log(`   Panel: ${m.panelId}`);

      if (m.pointer) {
        console.log(`   Pointer: x=${m.pointer.x}, y=${m.pointer.y}`);
      }

      if (m.cursorPosition) {
        console.log(`   Cursor: x=${m.cursorPosition.x}, y=${m.cursorPosition.y}`);
      }

      if (m.edges) {
        console.log(`   Edges: ${m.edges}`);
      }

      if (m.velocity) {
        console.log(`   Velocity: x=${m.velocity.x}, y=${m.velocity.y}`);
      }

      if (m.stateTransition) {
        console.log(`   Transition: ${m.stateTransition}`);
      }

      if (m.activationDelay) {
        console.log(`   Activation Delay: ${m.activationDelay}ms`);
      }

      if (m.reason) {
        console.log(`   Reason: ${m.reason}`);
      }

      if (m.threshold) {
        console.log(`   Threshold: ${m.threshold}px`);
      }

      console.log('');
    });

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
