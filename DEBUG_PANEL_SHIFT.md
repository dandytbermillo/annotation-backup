# Debug Guide: Panel Shifting on First Drag

## Issue
Panels shift unexpectedly when first dragged, but subsequent drags work normally.

## Debug Logs Added

The following instrumentation has been added to diagnose the root cause:

### 1. Drag Start (`drag_start` action)
Logs when mousedown initiates a drag, capturing:
- Initial panel position (world coordinates)
- Cursor position (viewport coordinates)
- Viewport dimensions
- Distance from cursor to all viewport edges
- Auto-scroll threshold (80px)
- Camera enabled state
- Current canvas transform state (translateX, translateY, zoom)

### 2. Mouse Move (`drag_mousemove` action)
Logs first 3 mousemove events during drag, capturing:
- Move count (1, 2, 3)
- Current cursor position
- Distance to viewport edges
- Whether cursor is in auto-scroll zone (<80px from edge)
- Current auto-scroll offset accumulation
- Pointer delta from drag start

### 3. Auto-Scroll (`auto_scroll` action)
Logs whenever auto-scroll triggers, capturing:
- Scroll delta being applied
- Current offset accumulation
- Camera enabled state
- Move count when auto-scroll triggered

## How to Investigate

### Step 1: Start the app
```bash
npm run dev
```

### Step 2: Reproduce the issue
1. Open the app
2. Drag a panel and observe if it shifts
3. The debug logs will automatically write to the database

### Step 3: Query the logs
```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })
  await client.connect()

  // Get drag sequence
  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'CanvasPanel'
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY id ASC
    LIMIT 50
  `)

  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

### Step 4: Analyze the sequence

Look for this pattern to validate/refute the auto-scroll hypothesis:

**Expected if auto-scroll is the cause:**
1. `drag_start`: cursor position < 80px from left edge
2. `drag_mousemove` (count: 1): `willTriggerAutoScroll: true`
3. `auto_scroll`: non-zero delta (e.g., `{x: 5, y: 0}`)
4. Repeated `auto_scroll` events while in edge zone

**Expected if NOT auto-scroll:**
1. `drag_start`: cursor position > 80px from all edges
2. `drag_mousemove` (count: 1): `willTriggerAutoScroll: false`
3. NO `auto_scroll` events
4. But panel still shifts (indicates different root cause)

### Step 5: Check specific metrics

From the `drag_start` log:
- `distanceToLeftEdge`: If < 80, auto-scroll WILL trigger
- `initialPosition.x`: Panel's world X coordinate
- `canvasState.translateX`: Canvas camera offset

From `drag_mousemove` (count: 1):
- `currentAutoScrollOffset`: Should be `{x:0, y:0}` if no auto-scroll yet
- `pointerDelta`: Should be small on first move (usually < 5px)

From `auto_scroll`:
- `scrollDelta`: The pan amount being applied
- `moveCount`: When during drag this triggered (1 = immediate)

## What to Look For

### Scenario A: Auto-scroll IS the cause
- Cursor < 80px from edge at drag start
- `auto_scroll` events immediately (moveCount: 1 or 2)
- `autoScrollOffset` accumulates on first move
- Panel position adjusts by `scrollDelta` amounts

**Fix:** Adjust auto-scroll threshold or add dead zone

### Scenario B: Auto-scroll is NOT the cause
- Cursor > 80px from all edges
- NO `auto_scroll` events
- Panel still shifts
- Check `initialPosition` vs actual DOM `style.left/top`
- Check if `renderPosition` state desyncs from DOM

**Fix:** Investigate coordinate space conversion or state initialization

### Scenario C: Camera transform issue
- `canvasState.translateX/Y` non-zero at start
- Initial position calculation includes transform
- But render doesn't account for it
- Position math: `baseX - autoScrollOffset.x` where offset shouldn't apply yet

**Fix:** Verify world-space vs screen-space coordinate handling

## Cleanup

After investigation, remove or disable the debug logs:
1. Comment out the `debugLog()` calls in `components/canvas/canvas-panel.tsx`
2. Or set `DEBUG_LOGGING_ENABLED = false` in `lib/utils/debug-logger.ts`

The logs auto-delete after 24 hours via database trigger.
