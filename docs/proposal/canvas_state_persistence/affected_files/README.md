# Affected Files - Branch Panel Persistence Issue

**Research Plan:** `../BRANCH_PANEL_PERSISTENCE_RESEARCH_PLAN.md`
**Implementation Plan:** `../implementation.md`
**Snapshot Date:** 2025-10-13

---

## Purpose

This directory contains snapshots of all files involved in the branch panel persistence issue. These files are copied here for reference during research and to track changes made during the fix implementation.

---

## File Inventory

### Primary Components

1. **`annotation-canvas-modern.tsx`** (63.6 KB)
   - **Role:** Main canvas rendering component
   - **Key Areas:**
     - Lines 1106-1115: Position determination logic (world→screen conversion)
     - Lines 247-281: Main panel persistence useEffect
     - Lines 1135-1155: handleCreatePanel for branch panels
   - **Issues:** Position determination was treating position as screen-space instead of world-space

2. **`canvas-context.tsx`** (21.1 KB)
   - **Role:** Canvas context provider, branch loader
   - **Key Areas:**
     - Lines 368-445: Branch loader logic that may overwrite hydrated positions
     - Lines 389-414: Attempts to preserve existing data from hydration
   - **Issues:** Race condition - runs before hydration completes, overwrites position data

3. **`use-canvas-hydration.ts`** (20.8 KB)
   - **Role:** Loads persisted canvas state on mount
   - **Key Areas:**
     - Lines 444-460: Panel data structure (stores world-space coords)
     - Lines 451-452: Sets both position and worldPosition to world-space
     - Lines 420-504: applyPanelLayout converts world→screen, stores world
   - **Issues:** May have timing issues with branch loader

4. **`use-panel-persistence.ts`** (12.7 KB)
   - **Role:** Saves panel state to database
   - **Key Areas:**
     - Lines 203-260: persistPanelCreate (converts screen→world, saves to DB)
     - Lines 88-98: persistPanelUpdate (stores both screen + world in dataStore)
   - **Issues:** Update logic may mix coordinate spaces

### Utility Files

5. **`coordinate-utils.ts`** (4.3 KB)
   - **Role:** Coordinate system conversion helpers
   - **Functions:**
     - `worldToScreen(world, camera, zoom)`: Converts world-space to screen-space
     - `screenToWorld(screen, camera, zoom)`: Converts screen-space to world-space
     - `sizeWorldToScreen()`, `sizeScreenToWorld()`: Size conversions
   - **Issues:** None (utility functions work correctly)

6. **`data-store.ts`** (769 B)
   - **Role:** In-memory state management
   - **Key Method:**
     - `update(key, updates)`: Merges existing data with updates
   - **Issues:** None (merge logic works correctly)

---

## Known Issues at Snapshot Time

### Issue 1: Race Condition
- **Component:** `canvas-context.tsx` branch loader
- **Problem:** Runs before hydration completes (130ms gap)
- **Impact:** Overwrites hydrated worldPosition with undefined
- **Status:** Attempted fix in lines 389-441 (conditional update)

### Issue 2: Coordinate System Confusion
- **Component:** `annotation-canvas-modern.tsx` render logic
- **Problem:** Was treating `position` field as screen-space instead of world-space
- **Impact:** Incorrect coordinate conversion, panels appear at wrong positions
- **Status:** Fixed in lines 1109-1115 (now properly converts world→screen)

### Issue 3: WorldPosition Not Preserved
- **Component:** `canvas-context.tsx` branch loader
- **Problem:** `dataStore.update()` may not preserve worldPosition field
- **Impact:** Hydration sets worldPosition, branch loader removes it
- **Status:** Attempted fix (branch loader doesn't set position fields)

### Issue 4: Main Panel vs Branch Panel Asymmetry
- **Component:** `annotation-canvas-modern.tsx`
- **Problem:** Main panel has dedicated useEffect persistence, branches don't
- **Impact:** Main panel always persists, branches may not
- **Status:** Main panel useEffect added (lines 247-281)

---

## Changes Made (at snapshot time)

### Recent Fixes Applied:

1. **Main Panel Persistence** (annotation-canvas-modern.tsx:247-281)
   - Added useEffect to persist main panel after hydration
   - Ensures main panel always saved to database on first note open

2. **World-Space Coordinate Fix** (annotation-canvas-modern.tsx:1109-1115)
   - Changed position determination to always convert world→screen
   - Per implementation.md line 97 requirement

3. **Branch Loader Simplified** (canvas-context.tsx:386-441)
   - Branch loader no longer sets position fields
   - Only updates annotation-related fields (title, content, preview)
   - Lets hydration handle ALL position data

4. **Explicit WorldPosition** (use-canvas-hydration.ts:452)
   - Added explicit `worldPosition: panel.position` field
   - Helps branch loader detect hydrated data

---

## Architecture Requirements (from implementation.md)

Per `/docs/proposal/canvas_state_persistence/implementation.md`:

- **Line 86-87:** "All client stores (`dataStore`, `branchesMap`, `LayerManager`) hold world-space position/size values"
- **Line 97:** "Components treat store values as world-space. On render they read the current camera/zoom from context and compute `const screenPos = worldToScreen(panel.positionWorld, camera, zoom)`"
- **Line 224:** "Creating a note should provision an empty canvas set; the first panel insert persists immediately"

**Critical Rule:** Stores MUST hold world-space coordinates. Components MUST convert world→screen during rendering.

---

## Debug Log Components

For investigating this issue, check debug logs from:

- `CanvasHydration` - hydration lifecycle
- `CanvasContext` - branch loader execution
- `AnnotationCanvas` - position determination
- `PanelPersistence` - save operations

See `BRANCH_PANEL_PERSISTENCE_RESEARCH_PLAN.md` for specific log queries.

---

## Next Steps

1. Execute research plan phases 1-5
2. Collect debug logs and database state
3. Identify exact root cause
4. Document findings in `BRANCH_PANEL_PERSISTENCE_RESEARCH_RESULT.md`
5. Implement verified fix
6. Update these files with final working versions

---

## References

- **Research Plan:** `../BRANCH_PANEL_PERSISTENCE_RESEARCH_PLAN.md`
- **Implementation Spec:** `../implementation.md` (lines 86-87, 97, 224)
- **Previous Fixes:** `../COMPLETE_FIX_VERIFICATION.md`
- **Debug Guide:** `/codex/how_to/debug_logs.md`
