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
        'drag_start',
        'drag_mouse_move',
        'auto_scroll_ACTIVATED',
        'auto_scroll_DEACTIVATED',
        'auto_scroll_EXECUTING',
        'drag_end'
      )
      AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    console.log('\n=== AUTO-SCROLL DEBUG LOGS (Last 3 minutes) ===\n');
    console.log(`Found ${result.rows.length} events\n`);

    // Show only key events, not every execution
    const filteredRows = result.rows.filter(row =>
      row.action === 'drag_start' ||
      row.action === 'drag_end' ||
      row.action === 'auto_scroll_ACTIVATED' ||
      row.action === 'auto_scroll_DEACTIVATED' ||
      (row.action === 'drag_mouse_move' && row.metadata.nearEdge && row.metadata.nearEdge.any)
    );

    console.log(`Showing ${filteredRows.length} key events (filtered from ${result.rows.length})\n`);

    filteredRows.forEach((row, i) => {
      const m = row.metadata;
      console.log(`${i + 1}. [${row.time}] ${row.component} → ${row.action}`);

      if (m.panelId) console.log(`   Panel: ${m.panelId}`);

      if (m.cursorPosition) {
        console.log(`   Cursor: x=${m.cursorPosition.x}, y=${m.cursorPosition.y}`);
      }

      if (m.pointer) {
        console.log(`   Pointer: x=${m.pointer.x}, y=${m.pointer.y}`);
      }

      if (m.nearEdge && m.nearEdge.any) {
        const edges = [];
        if (m.nearEdge.left) edges.push('LEFT');
        if (m.nearEdge.right) edges.push('RIGHT');
        if (m.nearEdge.top) edges.push('TOP');
        if (m.nearEdge.bottom) edges.push('BOTTOM');
        console.log(`   Near Edge: ${edges.join(', ')}`);
      }

      if (m.edges) console.log(`   Triggered Edges: ${m.edges}`);

      if (m.velocity) {
        console.log(`   Velocity: x=${m.velocity.x}, y=${m.velocity.y}`);
      }

      if (m.scrollDelta) {
        console.log(`   Scroll Delta: x=${m.scrollDelta.x}, y=${m.scrollDelta.y}`);
      }

      if (m.stateTransition) console.log(`   Transition: ${m.stateTransition}`);
      if (m.scrollMethod) console.log(`   Scroll Method: ${m.scrollMethod}`);

      if (m.canvasState) {
        console.log(`   Canvas: translateX=${m.canvasState.translateX}, translateY=${m.canvasState.translateY}, zoom=${m.canvasState.zoom}`);
      }

      if (m.edgeDistances) {
        console.log(`   Distances: left=${m.edgeDistances.left}px, right=${m.edgeDistances.right}px, top=${m.edgeDistances.top}px, bottom=${m.edgeDistances.bottom}px`);
      }

      console.log('');
    });

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
