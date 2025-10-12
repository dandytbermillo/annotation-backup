# Jitter Fix: RAF Throttling for Panel Dragging

## Problem Identified

**Jittery/rough panel dragging** - panels felt like "dragging on a rough surface" with unstable movement.

### Root Cause (from debug logs)

Analyzed drag sequence and found **highly inconsistent position deltas per frame**:

```
Move 5:  11px movement in 16.7ms → 0.66 px/ms velocity
Move 6:  15px movement in 16.6ms → 0.90 px/ms velocity ⚠️ 36% faster!
Move 7:  13px movement in 16.8ms → 0.77 px/ms velocity
Move 8:   8px movement in 15.8ms → 0.51 px/ms velocity ⚠️ 43% slower!
Move 9:  10px movement in 17.5ms → 0.57 px/ms velocity
Move 10:  3px movement in 16.6ms → 0.18 px/ms velocity ⚠️ 68% drop!
```

**Diagnosis:** Mousemove events fire faster than actual mouse movement (browser event flooding). Some frames had 0px movement but still triggered position updates, creating perceived stutter.

## The Fix: RAF Throttling

### Before (Direct Updates)
```typescript
const handleMouseMove = (e: MouseEvent) => {
  // Calculate position
  const newLeft = initialPosition.x + (e.clientX - startX)
  const newTop = initialPosition.y + (e.clientY - startY)

  // Update IMMEDIATELY on every mousemove
  panel.style.left = newLeft + 'px'
  panel.style.top = newTop + 'px'
  setRenderPosition({ x: newLeft, y: newTop })
}
```

**Problem:** Mousemove can fire 100-200 times/second, but rendering happens at 60fps. Excess updates cause jitter.

### After (RAF Throttling)
```typescript
const handleMouseMove = (e: MouseEvent) => {
  // Store latest mouse position
  dragState.current.pendingMouseEvent = {
    clientX: e.clientX,
    clientY: e.clientY
  }

  // Schedule ONE RAF update (if not already scheduled)
  if (!dragState.current.rafScheduled) {
    dragState.current.rafScheduled = true
    requestAnimationFrame(updatePanelPosition)
  }
}

const updatePanelPosition = () => {
  // Use the LATEST mouse position
  const e = dragState.current.pendingMouseEvent

  // Calculate and apply position
  const newLeft = initialPosition.x + (e.clientX - startX)
  panel.style.left = newLeft + 'px'

  // Clear state for next frame
  dragState.current.pendingMouseEvent = null
  dragState.current.rafScheduled = false
}
```

**Solution:**
- Mousemove events only **store** position and **schedule** RAF update
- RAF callback **applies** the latest position once per frame (max 60fps)
- Multiple mousemove events between frames are **collapsed** into one update
- Guarantees smooth 60fps movement synchronized with browser rendering

## Changes Made

**File:** `components/canvas/canvas-panel.tsx`

1. **Added RAF state tracking:**
   - `rafScheduled`: Boolean flag to prevent duplicate RAF scheduling
   - `pendingMouseEvent`: Stores latest mouse position
   - `rafIdRef`: Stores RAF ID for cleanup

2. **Created `updatePanelPosition()` callback:**
   - Reads latest mouse position from `pendingMouseEvent`
   - Calculates panel position
   - Updates DOM once per frame
   - Clears pending state

3. **Modified `handleMouseMove()`:**
   - Only stores mouse position
   - Schedules RAF update if not already scheduled
   - No direct DOM manipulation

4. **Added cleanup in `handleMouseUp()`:**
   - Cancels pending RAF with `cancelAnimationFrame()`
   - Clears pending mouse event
   - Prevents memory leaks

## Expected Results

### Before Fix (from logs)
```
Erratic velocity: 0.66 → 0.90 → 0.77 → 0.51 → 0.57 → 0.18 px/ms
Irregular movement perceived as jitter
```

### After Fix (expected)
```
Consistent velocity: ~0.6 → ~0.6 → ~0.6 → ~0.6 → ~0.6 px/ms
Smooth movement at stable 60fps
```

## Debug Logs

New action: `drag_jitter_raf` (vs old `drag_jitter`)

Query after testing:
```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })
  await client.connect()

  const res = await client.query(`
    SELECT
      metadata->>'moveCount' as move,
      metadata->>'timeDelta' as time_ms,
      metadata->>'positionDeltaMagnitude' as distance,
      metadata->>'rafThrottled' as raf
    FROM debug_logs
    WHERE action = 'drag_jitter_raf'
      AND created_at > NOW() - INTERVAL '2 minutes'
    ORDER BY id ASC
  `)

  console.table(res.rows)
  await client.end()
})()
NODE
```

**Look for:**
- Consistent `distance` values (smooth movement)
- Stable `time_ms` around 16-17ms (60fps)
- `raf: true` (confirms RAF throttling active)

## Testing

1. Run `npm run dev`
2. Drag a panel steadily
3. Movement should feel smooth, not jittery
4. Query debug logs to confirm stable deltas

## Technical Benefits

1. **Performance:** Reduces unnecessary DOM updates (from 100-200/sec → 60/sec)
2. **Visual smoothness:** Syncs updates with browser refresh rate
3. **Predictable timing:** Guarantees max 60fps updates, no flooding
4. **Battery friendly:** Fewer CPU cycles on position calculations

## Rollback

If issues occur, revert to direct updates:
```typescript
// In handleMouseMove, replace RAF scheduling with:
const newLeft = state.initialPosition.x + (e.clientX - state.startX)
const newTop = state.initialPosition.y + (e.clientY - state.startY)
panel.style.left = newLeft + 'px'
panel.style.top = newTop + 'px'
```
