# Auto-Scroll Debug Log Guide

**Date:** 2025-01-12
**Purpose:** Track and analyze auto-scroll behavior during panel dragging
**Issue:** Auto-scroll triggers immediately when cursor approaches edge, even when user just wants to position panel near edge (no intention to scroll canvas)

---

## Overview

The auto-scroll feature automatically scrolls the canvas when the user drags a panel near the viewport edges. While useful for navigating large canvases, it can be overly aggressive and trigger when the user simply wants to position a panel near the edge.

This guide explains the debug logs added to understand when and why auto-scroll triggers.

---

## Debug Log Categories

### 1. **Panel Drag Lifecycle**

#### `drag_start`
**Component:** CanvasPanel
**When:** User starts dragging a panel (mousedown on header)
**What it shows:**
- Panel ID being dragged
- Initial panel position
- Cursor position
- Distance from all edges (left, right, top, bottom)
- Auto-scroll threshold (80px)
- Camera enabled state
- Current canvas state (translateX, translateY, zoom)

**Example:**
```json
{
  "component": "CanvasPanel",
  "action": "drag_start",
  "metadata": {
    "panelId": "main",
    "initialPosition": { "x": 200, "y": 150 },
    "cursorPosition": { "x": 250, "y": 180 },
    "viewport": { "width": 1920, "height": 1080 },
    "distanceToLeftEdge": 250,
    "distanceToRightEdge": 1670,
    "distanceToTopEdge": 180,
    "distanceToBottomEdge": 900,
    "autoScrollThreshold": 80,
    "cameraEnabled": true
  }
}
```

**How to use:**
- Check if cursor starts near edges (< 80px)
- See initial canvas state before dragging

---

#### `drag_mouse_move`
**Component:** CanvasPanel
**When:** Every mouse movement during drag
**What it shows:**
- Current cursor position
- Distance to all edges
- Boolean flags for which edges are near (< threshold)
- Drag state (pointer delta, auto-scroll offset)
- Move count (how many mousemove events occurred)

**Example:**
```json
{
  "component": "CanvasPanel",
  "action": "drag_mouse_move",
  "metadata": {
    "panelId": "main",
    "moveCount": 15,
    "cursorPosition": { "x": 50, "y": 300 },
    "distanceToEdges": {
      "left": 50,
      "right": 1870,
      "top": 300,
      "bottom": 780
    },
    "nearEdge": {
      "left": true,    // ← 50px < 80px threshold
      "right": false,
      "top": false,
      "bottom": false,
      "any": true      // ← At least one edge is near
    },
    "threshold": 80,
    "aboutToCheckAutoScroll": true,
    "dragState": {
      "pointerDelta": { "x": -200, "y": 120 },
      "autoScrollOffset": { "x": 0, "y": 0 }
    }
  }
}
```

**How to use:**
- Track cursor movement during drag
- See when cursor enters/exits edge threshold zones
- Correlate with auto-scroll activation logs

**Note:** This logs on EVERY mouse move, so there will be many entries during a drag. Use `moveCount` to track sequence.

---

#### `drag_end`
**Component:** CanvasPanel
**When:** User releases mouse button (mouseup)
**What it shows:**
- Final panel position
- Render position vs prop position
- Final drag state

**How to use:**
- Verify panel ended up where expected
- Check if auto-scroll offset affected final position

---

### 2. **Auto-Scroll State Transitions**

#### `auto_scroll_ACTIVATED`
**Component:** useAutoScroll
**When:** Auto-scroll starts OR continues because cursor is near edge
**What it shows:**
- Cursor position
- Calculated velocity (x, y)
- Which edges are active (LEFT, RIGHT, TOP, BOTTOM)
- Distance to all edges
- Threshold and speed settings
- State transition (START vs CONTINUE)

**Example:**
```json
{
  "component": "useAutoScroll",
  "action": "auto_scroll_ACTIVATED",
  "metadata": {
    "pointer": { "x": 45, "y": 500 },
    "velocity": { "x": 3.5, "y": 0 },
    "edges": "LEFT",
    "edgeDistances": {
      "left": 45,
      "right": 1875,
      "top": 500,
      "bottom": 580
    },
    "threshold": 80,
    "speed": 8,
    "viewport": { "width": 1920, "height": 1080 },
    "wasActive": false,
    "stateTransition": "START"  // ← First activation
  }
}
```

**How to use:**
- **This is the KEY log to identify unwanted auto-scroll triggers**
- Check `stateTransition`:
  - `START` = auto-scroll just started
  - `CONTINUE` = auto-scroll already running
- Check `edges` to see which edge(s) triggered it
- Check `velocity` to see scroll speed/direction
- Check `edgeDistances` to see how close cursor was

**Velocity calculation:**
- `velocityX = speed * (1 - distance / threshold)`
- Closer to edge = higher velocity
- At edge (0px): velocity = 8 (max speed)
- At threshold (80px): velocity = 0 (no scroll)

---

#### `auto_scroll_DEACTIVATED`
**Component:** useAutoScroll
**When:** Cursor moves away from edges (auto-scroll stops)
**What it shows:**
- Cursor position when it stopped
- Distance to edges (should all be > threshold)

**Example:**
```json
{
  "component": "useAutoScroll",
  "action": "auto_scroll_DEACTIVATED",
  "metadata": {
    "pointer": { "x": 150, "y": 500 },
    "edgeDistances": {
      "left": 150,   // ← Now > 80px threshold
      "right": 1770,
      "top": 500,
      "bottom": 580
    },
    "threshold": 80,
    "reason": "cursor_moved_away_from_edges"
  }
}
```

**How to use:**
- Verify cursor actually moved away from edges
- Check if deactivation happened when expected

---

#### `auto_scroll_not_triggered`
**Component:** useAutoScroll
**When:** Cursor NOT near edges (logged every 10th check to reduce spam)
**What it shows:**
- Cursor position
- Distance to all edges (all should be > threshold)
- Check count

**Example:**
```json
{
  "component": "useAutoScroll",
  "action": "auto_scroll_not_triggered",
  "metadata": {
    "pointer": { "x": 960, "y": 540 },
    "edgeDistances": {
      "left": 960,
      "right": 960,
      "top": 540,
      "bottom": 540
    },
    "threshold": 80,
    "reason": "cursor_not_near_edges",
    "checkCount": 50
  }
}
```

**How to use:**
- Baseline to understand normal (non-scrolling) drag behavior
- Only logged every 10 checks to avoid spam

---

### 3. **Auto-Scroll Execution**

#### `auto_scroll_EXECUTING`
**Component:** CanvasPanel
**When:** Auto-scroll actually scrolls the canvas (called by useAutoScroll's onScroll callback)
**What it shows:**
- Scroll delta (how much to scroll in x/y)
- Current panel position
- Canvas transform before scroll
- Canvas state (translateX, translateY, zoom)
- Drag state (initial position, pointer delta, auto-scroll offset)
- Scroll method (CAMERA_PAN vs LEGACY_PANEL_MOVE)

**Example:**
```json
{
  "component": "CanvasPanel",
  "action": "auto_scroll_EXECUTING",
  "metadata": {
    "panelId": "main",
    "scrollDelta": { "x": 3.5, "y": 0 },
    "currentPanelPosition": { "left": "180px", "top": "300px" },
    "cameraEnabled": true,
    "moveCount": 20,
    "canvasTransformBefore": "matrix(1, 0, 0, 1, -1523, -1304)",
    "canvasState": {
      "translateX": -1523,
      "translateY": -1304,
      "zoom": 1
    },
    "dragState": {
      "initialPosition": { "x": 200, "y": 150 },
      "pointerDelta": { "x": -20, "y": 150 },
      "autoScrollOffset": { "x": 0, "y": 0 }
    },
    "scrollMethod": "CAMERA_PAN"
  }
}
```

**How to use:**
- See actual scroll deltas being applied
- Track canvas transform changes
- Understand cumulative auto-scroll offset
- **Correlate with `auto_scroll_ACTIVATED` to see activation → execution flow**

---

## How to Analyze the Auto-Scroll Issue

### Step 1: Reproduce the Issue

1. Open the app with dev tools
2. Create or open a note with a panel
3. Start dragging the panel toward any edge
4. Watch when auto-scroll triggers

### Step 2: Query Debug Logs

**SQL query to see the sequence:**
```sql
SELECT
  component,
  action,
  metadata->'panelId' as panel_id,
  metadata->'cursorPosition' as cursor,
  metadata->'nearEdge' as near_edge,
  metadata->'edges' as triggered_edges,
  metadata->'velocity' as velocity,
  metadata->'stateTransition' as transition,
  created_at
FROM debug_logs
WHERE action IN (
  'drag_start',
  'drag_mouse_move',
  'auto_scroll_ACTIVATED',
  'auto_scroll_DEACTIVATED',
  'auto_scroll_EXECUTING',
  'drag_end'
)
AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at ASC;
```

### Step 3: Look for Patterns

**Question 1: When does auto-scroll activate?**
Look for `auto_scroll_ACTIVATED` with `stateTransition: "START"`:
```sql
SELECT
  metadata->'pointer' as cursor_position,
  metadata->'edgeDistances' as distances,
  metadata->'edges' as which_edges,
  metadata->'velocity' as scroll_velocity,
  created_at
FROM debug_logs
WHERE action = 'auto_scroll_ACTIVATED'
  AND metadata->>'stateTransition' = 'START'
ORDER BY created_at DESC
LIMIT 10;
```

**Question 2: How many mouse moves before auto-scroll triggers?**
```sql
SELECT
  drag_start.created_at as drag_start_time,
  auto_scroll.created_at as auto_scroll_start_time,
  (auto_scroll.created_at - drag_start.created_at) as time_to_trigger,
  auto_scroll.metadata->'edges' as triggered_edges
FROM debug_logs drag_start
JOIN debug_logs auto_scroll ON
  drag_start.metadata->>'panelId' = auto_scroll.metadata->>'panelId'
WHERE drag_start.action = 'drag_start'
  AND auto_scroll.action = 'auto_scroll_ACTIVATED'
  AND auto_scroll.metadata->>'stateTransition' = 'START'
  AND auto_scroll.created_at > drag_start.created_at
  AND auto_scroll.created_at < drag_start.created_at + INTERVAL '10 seconds'
ORDER BY drag_start.created_at DESC
LIMIT 5;
```

**Question 3: Did user intentionally move toward edge or just happen to get close?**

Look at `drag_mouse_move` logs leading up to `auto_scroll_ACTIVATED`:
- Check `nearEdge.left/right/top/bottom` flags
- See if cursor gradually approached edge or jumped there
- Check `pointerDelta` to see direction of movement

---

## Common Scenarios to Look For

### Scenario 1: User Dragging Panel to Position It Near Edge

**Expected behavior:**
- User wants panel positioned near edge
- Cursor gets within 80px threshold
- Auto-scroll triggers (UNWANTED)

**Debug log sequence:**
1. `drag_start` - cursor not near edge
2. Multiple `drag_mouse_move` - cursor gradually approaching edge
3. `drag_mouse_move` - `nearEdge.left: true` (< 80px)
4. `auto_scroll_ACTIVATED` - `stateTransition: "START"`
5. `auto_scroll_EXECUTING` - canvas starts scrolling (UNWANTED)

**Identifying characteristic:**
- Cursor approaches edge slowly (small deltas per move)
- User may immediately move cursor back (quick deactivation)

---

### Scenario 2: User Dragging Panel to Scroll Canvas Intentionally

**Expected behavior:**
- User wants to scroll canvas while dragging
- Moves cursor to edge deliberately
- Auto-scroll triggers (WANTED)

**Debug log sequence:**
1. `drag_start` - cursor not near edge
2. Multiple `drag_mouse_move` - cursor rapidly approaching edge
3. `drag_mouse_move` - `nearEdge.left: true`
4. `auto_scroll_ACTIVATED` - `stateTransition: "START"`
5. Multiple `auto_scroll_ACTIVATED` - `stateTransition: "CONTINUE"` (stays at edge)
6. Multiple `auto_scroll_EXECUTING` - canvas scrolling continuously (WANTED)

**Identifying characteristic:**
- Cursor stays at edge for sustained period
- Many `CONTINUE` transitions
- Many `auto_scroll_EXECUTING` calls

---

## Proposed Improvements (To Be Implemented)

Based on debug log analysis, potential improvements:

### Option 1: Activation Delay
**Idea:** Don't trigger auto-scroll immediately when cursor enters threshold zone. Wait 200-300ms first.

**How to detect if this would help:**
- Check time between `nearEdge: true` and `auto_scroll_ACTIVATED`
- If it's < 200ms, and user moves away quickly, it was likely unintentional

### Option 2: Smaller Threshold
**Idea:** Reduce threshold from 80px to 40-50px

**How to detect if this would help:**
- Check `edgeDistances` when auto-scroll activates
- If most activations happen at 50-80px range, reducing threshold would prevent them

### Option 3: Velocity-Based Activation
**Idea:** Only trigger if cursor is moving TOWARD the edge with sufficient velocity

**How to detect if this would help:**
- Calculate cursor velocity from consecutive `drag_mouse_move` logs
- Check if unwanted activations have low cursor velocity

### Option 4: Dead Zone
**Idea:** Create a "dead zone" at 60-80px where auto-scroll doesn't trigger, only activate at < 60px

**How to detect if this would help:**
- Same as Option 2 - check activation distances

---

## Next Steps

1. **Collect data** - Drag panels around and trigger auto-scroll in various scenarios
2. **Run analysis queries** - Identify unwanted vs wanted auto-scroll activations
3. **Choose improvement approach** - Based on data patterns
4. **Implement and test** - Apply changes and verify with debug logs
5. **Document final solution** - Update this guide with findings

---

## Debug Log Cleanup

To disable debug logs after analysis:

**Option 1: Comment out logs**
```typescript
// In canvas-panel.tsx and use-auto-scroll.ts
// Comment out debugLog() calls
```

**Option 2: Add feature flag**
```typescript
const AUTO_SCROLL_DEBUG = false // Set to false in production

if (AUTO_SCROLL_DEBUG) {
  debugLog({ ... })
}
```

**Option 3: Keep logs but reduce frequency**
```typescript
// Only log every Nth event
if (state.mouseMoveCount % 10 === 0) {
  debugLog({ ... })
}
```

---

## Files Modified

**Added debug logs to:**
1. `/components/canvas/canvas-panel.tsx`
   - Line ~1730: `drag_mouse_move` logging
   - Line ~579: `auto_scroll_EXECUTING` logging

2. `/components/canvas/use-auto-scroll.ts`
   - Line ~86: `auto_scroll_ACTIVATED` logging
   - Line ~104: `auto_scroll_DEACTIVATED` logging
   - Line ~122: `auto_scroll_not_triggered` logging

**Existing debug logs retained:**
- `drag_start` (already existed)
- `drag_end` (already existed)

---

## Summary

The debug logs provide complete visibility into:
1. **When** auto-scroll triggers (activation logs)
2. **Why** it triggers (edge distances, thresholds)
3. **How** it executes (scroll deltas, canvas transforms)
4. **User intent** (cursor movement patterns, drag behavior)

Use these logs to:
- Identify unwanted auto-scroll triggers
- Distinguish intentional vs accidental edge proximity
- Choose the right improvement approach
- Verify fixes work as expected

**Key log to watch:** `auto_scroll_ACTIVATED` with `stateTransition: "START"` - this is when unwanted scrolling begins.
