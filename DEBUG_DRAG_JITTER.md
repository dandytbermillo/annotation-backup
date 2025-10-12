# Debug Guide: Jittery/Rough Panel Dragging

## Issue
When dragging panels, movement feels rough/unsteady like "dragging on a rough surface" - panels jiggle instead of moving smoothly.

## Root Cause Hypothesis

**Competing Updates:** The jitter is likely caused by two systems updating panel positions simultaneously:

1. **mousemove handler** - Updates position on every mouse event (~100-200fps)
2. **auto-scroll RAF loop** - Runs at 60fps continuously when near viewport edges

When both are active, they create a "tug of war":
- mousemove sets: `panel.style.left = baseX - autoScrollOffset.x`
- RAF callback modifies: `autoScrollOffset.x += velocity.x`
- Next mousemove reads the modified offset → position jumps slightly
- This creates visible jitter

Even tiny auto-scroll velocities (0.2px/frame) cause jitter when competing with mousemove updates.

## Debug Logs Added

### 1. Jitter Metrics (`drag_jitter` action)
Logs moves 5-20 to capture steady-state dragging, showing:
- `timeDelta`: ms between mousemove events (irregular = jitter)
- `positionDelta`: { x, y } movement this frame
- `positionDeltaMagnitude`: total distance moved this frame
- `autoScrollOffset`: accumulated auto-scroll offset
- `hasAutoScrollInterference`: true if auto-scroll has modified position
- `hasDecimalPrecision`: true if position has sub-pixel values

### 2. Auto-scroll Events (`auto_scroll` action)
Already logging when auto-scroll applies deltas

## Investigation Steps

### Step 1: Reproduce and capture
```bash
npm run dev
# Drag a panel steadily in one direction
# Try to trigger the jittery feeling
```

### Step 2: Query jitter logs
```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })
  await client.connect()

  const res = await client.query(`
    SELECT id, component, action, metadata, created_at
    FROM debug_logs
    WHERE component = 'CanvasPanel'
      AND action IN ('drag_jitter', 'auto_scroll')
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY id ASC
    LIMIT 100
  `)

  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

### Step 3: Analyze the patterns

#### Pattern A: Auto-scroll interference (most likely)
```json
{
  "action": "drag_jitter",
  "metadata": {
    "moveCount": 7,
    "timeDelta": 16.7,  // ~60fps (good)
    "positionDeltaMagnitude": 3.2,  // smooth movement
    "hasAutoScrollInterference": false
  }
}
// Then suddenly:
{
  "action": "auto_scroll",
  "metadata": {
    "scrollDelta": { "x": 0.5, "y": 0 }
  }
}
{
  "action": "drag_jitter",
  "metadata": {
    "moveCount": 8,
    "timeDelta": 4.2,  // ← Irregular! (next event too soon)
    "positionDelta": { "x": -0.5, "y": 0 },  // ← Tiny backward jump!
    "hasAutoScrollInterference": true  // ← Culprit identified
  }
}
```

**Diagnosis:** Auto-scroll modifies `autoScrollOffset` between mousemoves, causing calculated position to jump slightly backward. This creates the jitter.

#### Pattern B: Irregular timing
```json
[
  { "timeDelta": 16.7 },  // 60fps
  { "timeDelta": 16.3 },  // 61fps
  { "timeDelta": 33.5 },  // 30fps ← Frame skip!
  { "timeDelta": 8.1 },   // 123fps ← Too fast!
  { "timeDelta": 16.9 }   // Back to 60fps
]
```

**Diagnosis:** Inconsistent event timing. Browser throttling mousemove or main thread blocking.

#### Pattern C: Sub-pixel accumulation
```json
{
  "calculatedPosition": { "x": 2034.7, "y": 1502.3 },
  "hasDecimalPrecision": true
}
{
  "calculatedPosition": { "x": 2035, "y": 1502 },  // ← Rounded!
  "hasDecimalPrecision": false
}
{
  "calculatedPosition": { "x": 2035.2, "y": 1502.1 },
  "hasDecimalPrecision": true
}
```

**Diagnosis:** Position calculation produces floats, but rendering rounds to integers inconsistently.

#### Pattern D: React re-render interference
```json
{
  "positionDelta": { "x": 5, "y": 3 },  // Normal movement
  "timeDelta": 16.7
}
{
  "positionDelta": { "x": 0, "y": 0 },  // ← Position unchanged!
  "timeDelta": 2.1  // ← But event fired quickly
}
```

**Diagnosis:** `setRenderPosition()` causing re-render that interferes with next update.

## Solutions by Diagnosis

### Fix A: Disable auto-scroll during normal drag
```typescript
// Only enable auto-scroll if cursor is < 80px from edge AND
// has been there for > 200ms (debounce)
const autoScrollDelay = 200
const autoScrollTimer = useRef<number | null>(null)

const checkAutoScrollDebounced = (x: number, y: number) => {
  const nearEdge = x < 80 || x > window.innerWidth - 80 ||
                   y < 80 || y > window.innerHeight - 80

  if (nearEdge) {
    if (!autoScrollTimer.current) {
      autoScrollTimer.current = setTimeout(() => {
        checkAutoScroll(x, y)
      }, autoScrollDelay)
    }
  } else {
    if (autoScrollTimer.current) {
      clearTimeout(autoScrollTimer.current)
      autoScrollTimer.current = null
    }
    stopAutoScroll()
  }
}
```

### Fix B: Synchronize updates with RAF
```typescript
// Move mousemove position updates into RAF
const rafRef = useRef<number | null>(null)
const pendingPosition = useRef<{x: number, y: number} | null>(null)

const handleMouseMove = (e: MouseEvent) => {
  if (!dragState.current.isDragging) return

  // Store target position
  pendingPosition.current = {
    x: state.initialPosition.x + (e.clientX - state.startX),
    y: state.initialPosition.y + (e.clientY - state.startY)
  }

  // Schedule RAF update if not already scheduled
  if (!rafRef.current) {
    rafRef.current = requestAnimationFrame(updatePosition)
  }
}

const updatePosition = () => {
  if (!pendingPosition.current) return

  const { x, y } = pendingPosition.current
  panel.style.left = x + 'px'
  panel.style.top = y + 'px'

  rafRef.current = null
  pendingPosition.current = null
}
```

### Fix C: Remove auto-scroll offset from drag calculation
```typescript
// Don't subtract autoScrollOffset in mousemove
// Let auto-scroll modify position directly without feedback loop
const newLeft = baseX  // Don't subtract autoScrollOffset!
const newTop = baseY
```

### Fix D: Avoid React state updates during drag
```typescript
// Don't call setRenderPosition during drag
// Only update DOM directly
// setRenderPosition({ x: newLeft, y: newTop })  // ← Remove
panel.style.left = newLeft + 'px'
panel.style.top = newTop + 'px'
```

## Quick Test

To verify auto-scroll is the cause, temporarily disable it:
```typescript
const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
  enabled: false,  // ← Disable
  threshold: 80,
  speed: 8,
  onScroll: handleAutoScroll
})
```

If dragging becomes smooth, auto-scroll interference is confirmed.

## Expected Smooth Drag Pattern

```json
[
  { "timeDelta": 16.7, "positionDeltaMagnitude": 3.2, "hasAutoScrollInterference": false },
  { "timeDelta": 16.8, "positionDeltaMagnitude": 3.1, "hasAutoScrollInterference": false },
  { "timeDelta": 16.6, "positionDeltaMagnitude": 3.3, "hasAutoScrollInterference": false },
  { "timeDelta": 16.7, "positionDeltaMagnitude": 3.2, "hasAutoScrollInterference": false }
]
```

- Consistent ~16-17ms timing (60fps)
- Consistent position deltas (smooth motion)
- No auto-scroll interference
- No decimal precision issues
