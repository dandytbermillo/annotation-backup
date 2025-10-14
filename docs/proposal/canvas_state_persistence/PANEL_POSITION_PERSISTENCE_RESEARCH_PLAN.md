# Panel Position Persistence Bug - Deep Research Plan

**Status:** 🔴 CRITICAL - Panel positions not persisting across page reloads
**Date:** 2025-10-13
**Priority:** P0 - Blocks Canvas State Persistence feature completion

## Executive Summary

Branch panel positions are not persisting after page reload, despite:
- ✅ Panel titles persisting correctly
- ✅ Panel header colors persisting correctly (annotation type stored in metadata)
- ❌ Panel positions reverting to default locations

## Problem Statement

When a user:
1. Creates a branch panel from an annotation
2. Moves the panel to a new position
3. Reloads the page

**Expected:** Panel appears at the moved position
**Actual:** Panel appears at default position (ignoring saved coordinates)

## Investigation Areas

### 1. Data Flow Analysis

#### 1.1 Panel Creation → Database Save
**Files:**
- `components/annotation-canvas-modern.tsx` (handleCreatePanel)
- `lib/hooks/use-panel-persistence.ts` (persistPanelCreate)
- `app/api/canvas/panels/route.ts` (POST endpoint)

**Questions:**
- Is `persistPanelCreate` being called when panel is created?
- Are coordinates being converted screen→world correctly?
- Is database INSERT succeeding?
- What values are stored in `position_x_world`, `position_y_world`?

**Test Query:**
```sql
SELECT panel_id, title, position_x_world, position_y_world,
       width_world, height_world, created_at, updated_at
FROM panels
WHERE type IN ('branch', 'context', 'annotation')
ORDER BY updated_at DESC LIMIT 5;
```

#### 1.2 Panel Drag → Database Update
**Files:**
- `components/canvas/canvas-panel.tsx` (drag handlers)
- `lib/hooks/use-panel-persistence.ts` (persistPanelUpdate)
- `app/api/canvas/layout/[noteId]/route.ts` (PATCH endpoint)

**Questions:**
- Is drag end event triggering persistence?
- Is `persistPanelUpdate` being called?
- Are dragged positions being saved to database?
- Is coordinate conversion happening correctly?

**Debug Logs to Check:**
```sql
SELECT component, action, metadata, created_at
FROM debug_logs
WHERE action IN ('drag_end_persisting', 'persisted_to_api', 'panel_update')
ORDER BY created_at DESC LIMIT 20;
```

#### 1.3 Page Reload → Database Load
**Files:**
- `lib/hooks/use-canvas-hydration.ts` (loadPanelLayout, applyPanelLayout)
- `app/api/canvas/layout/[noteId]/route.ts` (GET endpoint)

**Questions:**
- Is hydration running on page load?
- Is GET endpoint returning correct position data?
- Are world→screen coordinates being converted correctly?
- Is position data being stored in dataStore/branchesMap?

**Debug Logs to Check:**
```sql
SELECT component, action, metadata
FROM debug_logs
WHERE action IN ('hydration_complete', 'loaded_panels',
                'applied_panels_to_stores', 'applying_panel_type')
ORDER BY created_at DESC LIMIT 20;
```

#### 1.4 Hydrated Data → Panel Rendering
**Files:**
- `components/annotation-canvas-modern.tsx` (hydration effect, handleCreatePanel)
- `components/canvas/canvas-panel.tsx` (position prop usage)

**Questions:**
- Is `createPanelItem` receiving correct position?
- Is `branchData.worldPosition` set correctly?
- Is duplicate prevention working correctly?
- Is panel position being overridden after creation?

**Debug Logs to Check:**
```sql
SELECT component, action, metadata
FROM debug_logs
WHERE action IN ('determining_panel_position', 'panel_already_exists',
                'creating_canvas_items_from_hydration', 'hydrating_panel_with_type')
ORDER BY created_at DESC LIMIT 20;
```

### 2. Coordinate System Analysis

**Two coordinate systems in use:**

#### 2.1 World-Space Coordinates
- **Purpose:** Absolute canvas coordinates, independent of viewport
- **Storage:** Database columns `position_x_world`, `position_y_world`
- **Usage:** Persistence, cross-session consistency
- **Example:** `{x: 3650, y: 2700}`

#### 2.2 Screen-Space Coordinates
- **Purpose:** Viewport-relative coordinates for rendering
- **Calculation:** `screenPos = worldPos - camera + zoom adjustments`
- **Usage:** React component positioning
- **Example:** `{x: 2650, y: 1500}` (with camera at `{x: -1000, y: -1200}`)

**Critical Functions:**
```typescript
// lib/canvas/coordinate-utils.ts
screenToWorld(screenPos, camera, zoom) // Screen → World
worldToScreen(worldPos, camera, zoom)  // World → Screen
```

**Hypothesis:** Coordinate space mismatch causing position errors

### 3. Data Storage Investigation

#### 3.1 DataStore Position Fields
**File:** `lib/hooks/use-canvas-hydration.ts` (line 444-459)

```typescript
const panelData = {
  position: screenPosition,          // Screen-space (e.g., 2650, 1500)
  worldPosition: panel.position,     // World-space (e.g., 3650, 2700)
  size: screenSize,
  worldSize: panel.size,
  ...
}
dataStore.set(panel.id, panelData)
```

**Questions:**
- Is `worldPosition` being set correctly?
- Which field is `handleCreatePanel` reading?
- Is there a field name mismatch?

#### 3.2 Position Priority Logic
**File:** `components/annotation-canvas-modern.tsx` (line 1072)

```typescript
const position = branchData?.worldPosition || branchData?.position || parentPosition || { x: 2000, y: 1500 }
```

**Questions:**
- Does `branchData` exist when this runs?
- Does `branchData.worldPosition` exist?
- What value does `position` actually get?
- Is this being called multiple times?

### 4. Race Condition Analysis

**Potential race conditions:**

#### 4.1 Hydration vs Panel Creation
**Sequence:**
1. Page loads
2. Hydration loads panels from DB → adds to canvasItems
3. User clicks annotation icon
4. `handleCreatePanel` called → tries to create panel again
5. Duplicate check prevents re-creation
6. But what position is used?

**Questions:**
- Is panel being created before hydration completes?
- Is duplicate check working correctly?
- Is position being overridden after duplicate check?

#### 4.2 Multiple Panel Creation Calls
**Debug logs show:**
```
creating_panel_with_title (called twice for same panel)
```

**Questions:**
- Why is `handleCreatePanel` called twice?
- Are both calls using same position?
- Is second call overriding first?

### 5. Affected Files

All files copied to: `docs/proposal/canvas_state_persistence/affected_files/`

1. **annotation-canvas-modern.tsx** - Main canvas component
   - `handleCreatePanel` - Panel creation logic
   - Hydration effect - Loads saved panels
   - Position determination logic (line 1072)

2. **use-canvas-hydration.ts** - Panel loading/restoration
   - `loadPanelLayout` - Fetches from API
   - `applyPanelLayout` - Stores in dataStore/branchesMap
   - Coordinate conversion (world→screen)

3. **use-panel-persistence.ts** - Panel saving
   - `persistPanelCreate` - Initial save
   - `persistPanelUpdate` - Position updates
   - Coordinate conversion (screen→world)

4. **canvas-panel.tsx** - Panel rendering
   - Drag handlers
   - Position prop usage
   - `position_update_sources` debug logging

5. **panels-api-route.ts** - POST /api/canvas/panels
   - Panel creation endpoint
   - Stores world-space coordinates

6. **layout-api-route.ts** - GET/PATCH /api/canvas/layout/:noteId
   - Panel loading endpoint
   - Panel update endpoint
   - Returns world-space coordinates

7. **database-state.txt** - Current DB snapshot
8. **recent-debug-logs.txt** - Recent operation logs

## Research Methodology

### Phase 1: Trace Complete Flow (30 min)
1. **Start fresh:**
   - Delete all branch panels: `DELETE FROM panels WHERE type IN ('branch', 'context', 'annotation');`
   - Clear canvasItems state
   - Reload app

2. **Create panel:**
   - Create annotation
   - Click icon to open branch panel
   - **Capture:** All debug logs for this operation
   - **Verify:** Database has panel with correct position

3. **Move panel:**
   - Drag panel to new position
   - **Capture:** All debug logs for drag/save
   - **Verify:** Database position updated

4. **Reload app:**
   - Hard refresh (Cmd+Shift+R)
   - **Capture:** All hydration logs
   - **Verify:** Panel appears at correct position (or not)

### Phase 2: Data Inspection (15 min)
1. **Check database:**
   ```sql
   SELECT panel_id, position_x_world, position_y_world FROM panels
   WHERE panel_id = '<panel_id_from_test>';
   ```

2. **Check debug logs:**
   ```sql
   SELECT action, metadata FROM debug_logs
   WHERE metadata::text LIKE '%<panel_id>%'
   ORDER BY created_at ASC;
   ```

3. **Check dataStore contents:**
   - Add console.log in `handleCreatePanel` to print `branchData`
   - Verify `worldPosition` field exists

### Phase 3: Hypothesis Testing (30 min)
Based on data, test these hypotheses:

#### Hypothesis 1: worldPosition not being set
**Test:** Add debug log in hydration to print panelData before storing
```typescript
console.log('[Hydration] Storing panel data:', {
  id: panel.id,
  position: screenPosition,
  worldPosition: panel.position
})
dataStore.set(panel.id, panelData)
```

#### Hypothesis 2: Position being overridden after creation
**Test:** Add debug log in CanvasPanel to track position changes
```typescript
useEffect(() => {
  console.log('[CanvasPanel] Position changed:', panelId, position)
}, [position])
```

#### Hypothesis 3: Coordinate conversion error
**Test:** Verify conversions with known values
```typescript
const testWorld = {x: 3650, y: 2700}
const testScreen = worldToScreen(testWorld, {x: -1000, y: -1200}, 1.0)
console.log('World→Screen:', testWorld, '→', testScreen)
// Expected: {x: 2650, y: 1500}
```

#### Hypothesis 4: Duplicate panel creation race
**Test:** Add counter to track creation calls
```typescript
let creationCount = 0
const handleCreatePanel = (...) => {
  creationCount++
  console.log(`[Create] Call #${creationCount} for ${panelId}`)
  // Rest of function
}
```

### Phase 4: Root Cause Identification (15 min)
1. Review all evidence
2. Identify exact line where position is lost/wrong
3. Document root cause with evidence
4. Propose fix with specific code changes

### Phase 5: Fix Implementation (30 min)
1. Implement fix
2. Test manually
3. Verify with debug logs
4. Confirm positions persist across multiple reloads

## Success Criteria

✅ Panel positions saved to database correctly
✅ Panel positions loaded from database correctly
✅ Panel positions displayed at correct locations after reload
✅ Multiple panels maintain their positions
✅ Positions persist across multiple reloads
✅ Moving panels and reloading shows new positions

## Debug Commands Reference

### Database Queries
```bash
# Check saved positions
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, title, position_x_world, position_y_world, updated_at FROM panels WHERE type='branch' ORDER BY updated_at DESC LIMIT 5;"

# Clear panels
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "DELETE FROM panels WHERE type IN ('branch', 'context', 'annotation');"

# Check debug logs
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata FROM debug_logs WHERE component='AnnotationCanvas' ORDER BY created_at DESC LIMIT 20;"
```

### Key Log Actions to Monitor
- `creating_panel_with_title` - Panel creation
- `determining_panel_position` - Position selection
- `applying_panel_type` - Hydration storing
- `hydrating_panel_with_type` - Hydration loading
- `drag_end_persisting` - Save after drag
- `persisted_to_api` - API save success
- `panel_already_exists` - Duplicate detection

## Next Steps

1. **Execute Phase 1** - Complete flow trace with fresh panel
2. **Collect all evidence** - Database snapshots, debug logs, console output
3. **Analyze data** - Find where position is lost/wrong
4. **Implement fix** - With confidence from evidence
5. **Verify fix** - Multiple reload cycles

## Notes

- Focus on ONE panel at a time to reduce complexity
- Use consistent panel ID for all traces
- Compare database values vs rendered positions
- Check both creation and reload flows
- Verify coordinate conversions with calculator
