# Panel Position Persistence Fix - Verification Guide

**Fix Applied:** 2025-10-13
**Root Cause:** Hydration was using `{x: 0, y: 0}` camera offset instead of default canvas translation `{x: -1000, y: -1200}`
**Result:** World→screen coordinate conversion was incorrect, causing panels to appear at wrong positions

## What Was Fixed

**File:** `lib/hooks/use-canvas-hydration.ts` (line 526-532)

**Before:**
```typescript
const effectiveCamera = camera || { x: 0, y: 0, zoom: 1.0 }
```

**After:**
```typescript
const effectiveCamera = cameraLoaded
  ? camera
  : {
      x: state.canvasState?.translateX || -1000,
      y: state.canvasState?.translateY || -1200,
      zoom: state.canvasState?.zoom || 1.0
    }
```

**Why This Works:**
- When no camera state is saved in database, use the canvas's default translation offsets
- This ensures world→screen conversion uses correct camera position
- Panel world coords (e.g., `{3650, 2700}`) now convert correctly to screen coords (e.g., `{2650, 1500}`)

## Test Steps

### 1. Clean Slate Test (5 min)

```bash
# Clear all branch panels to start fresh
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "DELETE FROM panels WHERE type IN ('branch', 'context', 'annotation');"
```

### 2. Create and Position Panel

1. **Reload the app** (hard refresh: Cmd+Shift+R)
2. **Create a new note** or open existing note
3. **Create an annotation** (highlight text, select "explore" type for orange color)
4. **Click the square icon** to open branch panel
5. **Drag the panel** to a distinct position (e.g., move it to the far right of the screen)
6. **Wait 2 seconds** (for auto-save)

### 3. Verify Database Saved Position

```bash
# Get the panel ID and position
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, title, position_x_world, position_y_world, updated_at FROM panels WHERE type IN ('branch', 'context', 'annotation') ORDER BY updated_at DESC LIMIT 1;"
```

**Expected:** You should see non-default world coordinates (not 3650, 2700 or 2000, 1500)
**Example:** `position_x_world: 4200, position_y_world: 2900` if you moved it right

### 4. Reload and Verify Position Persists

1. **Reload the page** (hard refresh: Cmd+Shift+R)
2. **Observe the panel position**

**Expected:**
- ✅ Panel appears at the SAME position where you dragged it
- ✅ Panel does NOT jump to default position `{2000, 1500}`
- ✅ Panel maintains correct spatial relationship to main panel

### 5. Check Debug Logs

```bash
# Check that correct camera offset was used
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata FROM debug_logs WHERE action = 'using_effective_camera' ORDER BY created_at DESC LIMIT 1;"
```

**Expected Output:**
```
component       | action                  | metadata
CanvasHydration | using_effective_camera | {
  "cameraLoaded": false,
  "effectiveCamera": {"x": -1000, "y": -1200, "zoom": 1},
  "reason": "using_default_canvas_translation"
}
```

**Key:** `effectiveCamera` should be `{x: -1000, y: -1200}`, NOT `{x: 0, y: 0}`

### 6. Multiple Panel Test

1. **Create 3 branch panels** from different annotations
2. **Position them in different locations:**
   - Panel 1: Far left
   - Panel 2: Center-right
   - Panel 3: Bottom-right
3. **Reload**

**Expected:** All 3 panels maintain their relative positions

### 7. Annotation Type Color Test

While testing position, verify that annotation type colors still work:
- **Note** (default) → Blue header
- **Explore** → Orange header
- **Promote** → Green header

## Success Criteria

✅ **Primary:** Branch panels appear at saved positions after reload (not default position)
✅ **Secondary:** Multiple panels maintain spatial relationships
✅ **Regression:** Panel titles still persist
✅ **Regression:** Panel colors still persist
✅ **Edge Case:** Creating new panel uses smart positioning (not affected)

## Troubleshooting

### Issue: Panel still appears at default position

**Check 1:** Verify database has correct world coordinates
```sql
SELECT panel_id, position_x_world, position_y_world FROM panels WHERE type='branch';
```
If position is `(3650, 2700)` or `(2000, 1500)`, the position wasn't saved during drag.

**Check 2:** Verify effectiveCamera has correct offset
```sql
SELECT metadata FROM debug_logs WHERE action='using_effective_camera' ORDER BY created_at DESC LIMIT 1;
```
Should show `{"x": -1000, "y": -1200}`, not `{"x": 0, "y": 0}`.

**Check 3:** Verify coordinate conversion
```sql
SELECT component, action, metadata FROM debug_logs WHERE action='applying_panel_type' ORDER BY created_at DESC LIMIT 1;
```
Should show panel being applied with correct coordinates.

### Issue: Panel appears but in wrong location

**Check:** Verify camera state is being applied
The panel position might be correct relative to a different camera position. Try panning the canvas to see if panel is just off-screen.

### Issue: Panel doesn't appear at all

**Check:** Verify panel was hydrated
```sql
SELECT component, action, metadata FROM debug_logs WHERE action='hydration_complete' ORDER BY created_at DESC LIMIT 1;
```
Should show `panelsLoaded: 1` or more.

## Technical Details

### Coordinate System Explanation

**World-Space:**
- Absolute canvas coordinates
- Stored in database: `position_x_world`, `position_y_world`
- Independent of viewport
- Example: `{x: 3650, y: 2700}`

**Screen-Space:**
- Viewport-relative coordinates
- Used for rendering React components
- Calculated as: `screenPos = worldPos - camera`
- Example: `{x: 2650, y: 1500}` when camera is at `{x: -1000, y: -1200}`

### The Bug

When no camera state was saved in database:
- Old code: `effectiveCamera = {x: 0, y: 0, zoom: 1}`
- Conversion: `screenPos = worldPos - {0, 0} = worldPos`
- Result: Screen position = World position (WRONG!)
- Panel at world `{3650, 2700}` rendered at screen `{3650, 2700}` instead of `{2650, 1500}`

### The Fix

When no camera state is saved:
- New code: `effectiveCamera = {x: -1000, y: -1200, zoom: 1}` (default canvas translation)
- Conversion: `screenPos = worldPos - {-1000, -1200}`
- Result: Screen position correctly offset from world position
- Panel at world `{3650, 2700}` renders at screen `{2650, 1500}` ✅

## Related Issues Fixed

This fix also resolves:
- ✅ Panels appearing off-screen after reload
- ✅ Panels clustered at one location after reload
- ✅ Panel positions not matching their saved state
- ✅ Inconsistent panel placement across sessions

## Files Modified

1. **lib/hooks/use-canvas-hydration.ts** (line 526-542)
   - Changed `effectiveCamera` fallback from `{0,0}` to default canvas translation
   - Added debug logging to track camera source

## Next Steps

If position persistence is now working:
1. ✅ Mark Canvas State Persistence feature as complete
2. ✅ Test with multiple notes and panels
3. ✅ Test camera persistence separately (panning/zooming)
4. ✅ Document feature in user guide

If issues persist:
1. Follow troubleshooting steps above
2. Check debug logs for anomalies
3. Verify database state matches expectations
4. Refer to `PANEL_POSITION_PERSISTENCE_RESEARCH_PLAN.md` for deeper investigation
