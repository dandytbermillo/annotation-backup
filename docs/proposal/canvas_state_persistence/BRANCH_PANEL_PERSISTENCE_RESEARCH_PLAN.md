# Research Plan: Branch Panel Position Persistence Failure

**Created:** 2025-10-13
**Status:** IN PROGRESS
**Priority:** CRITICAL

---

## Problem Statement

**Observed Behavior:**
- ✅ **Main panel:** Position persists correctly across app reloads
- ❌ **Branch panels:** Positions do NOT persist correctly across app reloads
- Main panel appears at the correct saved position after reload
- Branch panels appear at incorrect positions (often default positions or wrong screen-space coords)

**Expected Behavior (per implementation.md):**
- All panels (main + branch) should persist their world-space positions to database
- On reload, hydration should restore all panels to their saved positions
- Coordinate conversion (world→screen) should work correctly for all panel types

---

## Research Objectives

1. **Identify the root cause** of branch panel persistence failure
2. **Document the exact execution flow** for main vs branch panels during:
   - Initial creation
   - Position updates (drag)
   - Hydration (reload)
3. **Analyze coordinate system handling** for each panel type
4. **Verify database state** - what's actually being saved vs expected
5. **Compare code paths** - how do main and branch panels differ?

---

## Hypothesis

Based on initial investigation, potential causes:

### Hypothesis 1: Race Condition (Branch Loader vs Hydration)
- **Theory:** Branch loader runs BEFORE hydration completes, overwriting hydrated positions
- **Evidence:** Debug logs show branch_loader timestamp < hydration timestamp (130ms gap)
- **Impact:** Branch loader sees no existing data, sets screen-space position without worldPosition
- **Files:** `components/canvas/canvas-context.tsx`, `lib/hooks/use-canvas-hydration.ts`

### Hypothesis 2: Coordinate System Confusion
- **Theory:** Branch panels stored with screen-space coords treated as world-space (or vice versa)
- **Evidence:**
  - `determining_panel_position` logs show `hasWorldPosition: false` for branches
  - Hydration stores `position: panel.position` (world) + `worldPosition: panel.position` (world)
  - Render logic was treating `position` as screen-space (before latest fix)
- **Impact:** Coordinate conversion fails, panels appear at wrong positions
- **Files:** `components/annotation-canvas-modern.tsx`, `lib/hooks/use-canvas-hydration.ts`

### Hypothesis 3: Branch Loader Overwrites Hydrated Data
- **Theory:** Branch loader calls `dataStore.update()` without preserving worldPosition
- **Evidence:**
  - Debug logs show `preservedPosition: {2747, 1946}` (screen-space from drag)
  - `hasWorldPosition: false` after branch loader runs
- **Impact:** Hydration sets worldPosition, branch loader removes it
- **Files:** `components/canvas/canvas-context.tsx`

### Hypothesis 4: Different Persistence Code Paths
- **Theory:** Main panel uses different persistence logic than branch panels
- **Evidence:**
  - Main panel persisted via useEffect in annotation-canvas-modern.tsx (lines 247-281)
  - Branch panels persisted via handleCreatePanel → persistPanelCreate
  - Main panel may have additional safeguards
- **Files:** `components/annotation-canvas-modern.tsx`, `lib/hooks/use-panel-persistence.ts`

---

## Research Methodology

### Phase 1: Database State Verification
**Goal:** Understand what's actually being saved

**Steps:**
1. Query database for main panel positions (working case)
   ```sql
   SELECT panel_id, note_id, position_x_world, position_y_world, type
   FROM panels WHERE panel_id='main' ORDER BY updated_at DESC LIMIT 5;
   ```

2. Query database for branch panel positions (failing case)
   ```sql
   SELECT panel_id, note_id, position_x_world, position_y_world, type
   FROM panels WHERE type='annotation' ORDER BY updated_at DESC LIMIT 5;
   ```

3. Compare: Are world-space coords actually being saved? Are they correct?

**Expected Findings:**
- Main panels: Valid world-space coords (e.g., {3523, 2805})
- Branch panels: Invalid/incorrect world-space coords? Or correct but not loaded?

---

### Phase 2: Execution Flow Analysis
**Goal:** Trace the complete lifecycle for both panel types

**Main Panel Flow (WORKING):**
```
1. App Load → annotation-canvas-modern.tsx mounts
2. useCanvasHydration runs → fetches panels from API
3. Hydration stores: position={world}, worldPosition={world}
4. useEffect (lines 247-281) checks: hasMainPanel in DB?
5. If NO → calls persistPanelCreate with current position
6. Render: No branch loader interference (main panel not a branch)
7. Position determined from: branchData.position (world) → convert to screen
8. Result: ✅ Panel appears at correct position
```

**Branch Panel Flow (FAILING):**
```
1. App Load → annotation-canvas-modern.tsx mounts
2. canvas-context.tsx: Branch loader runs (timestamp: T)
3. Branch loader: existing = dataStore.get(branchId) → undefined
4. Branch loader: sets minimal data (NO position fields)
5. useCanvasHydration runs (timestamp: T+130ms)
6. Hydration stores: position={world}, worldPosition={world}
7. Branch loader runs AGAIN (after annotation data loads)
8. Branch loader: existing = dataStore.get(branchId) → has data
9. Branch loader: calls dataStore.update() → preserves existing.position
10. Problem: existing.position may be screen-space from previous drag?
11. Render: branchData.position (confused coords) → wrong conversion
12. Result: ❌ Panel appears at wrong position
```

**Key Questions:**
- Why does branch loader run multiple times?
- Why does it run before AND after hydration?
- What's in `existing.position` when branch loader preserves it?

---

### Phase 3: Debug Log Analysis
**Goal:** Collect comprehensive debug logs for one complete reload cycle

**Required Logs:**
1. **Hydration logs:**
   - `using_effective_camera` - what camera is used for conversion?
   - `storing_panel_data` - what coords are stored (world vs screen)?
   - `hydration_complete` - when does it finish?

2. **Branch loader logs:**
   - `branch_loader_reading_existing` - what exists in dataStore?
   - `branch_loader_updated_existing` - what's preserved?
   - `branch_loader_created_new` - when is new data created?

3. **Render logs:**
   - `determining_panel_position` - what position is used for rendering?
   - `hasWorldPosition` - is worldPosition available?
   - `branchDataPosition` - what coords are used?

4. **Persistence logs:**
   - `attempting_panel_create` - what coords are being saved?
   - `panel_created` - did save succeed?
   - Camera used, worldPosition, screenPosition

**Timeline Construction:**
Sort all logs by timestamp to understand exact execution order and identify race conditions.

---

### Phase 4: Code Path Comparison
**Goal:** Identify differences between main and branch panel handling

**Analysis Matrix:**

| Aspect | Main Panel | Branch Panel |
|--------|------------|--------------|
| **Creation** | createDefaultCanvasItems() + useEffect persist | handleCreatePanel → persistPanelCreate |
| **Hydration** | Hydration sets position + worldPosition | Hydration sets position + worldPosition |
| **Branch Loader** | ❌ Not affected (not a branch) | ✅ Runs and may overwrite |
| **Position Source** | branchData.position (world) | branchData.position (world?) |
| **Coordinate Conversion** | worldToScreen() in render | worldToScreen() in render (same logic) |
| **Persistence Trigger** | useEffect on mount | Drag update (debounced) |

**Key Difference Found:**
- Main panel: No branch loader interference
- Branch panel: Branch loader runs before/after hydration, may corrupt data

---

### Phase 5: Coordinate System Audit
**Goal:** Verify coordinate system consistency across all components

**Audit Checklist:**

| Component | What it stores | Expected Space | Actual Space | Correct? |
|-----------|---------------|----------------|--------------|----------|
| **Database (panels table)** | position_x_world, position_y_world | World | World | ✅ |
| **Hydration (dataStore)** | position, worldPosition | World | World | ✅ |
| **Branch Loader (dataStore.update)** | position (preserved) | World | ??? | ❓ |
| **usePanelPersistence (drag update)** | position, worldPosition | Screen + World | Screen + World | ✅ |
| **Render (annotation-canvas-modern)** | branchData.position | World → Screen | World → Screen | ✅ (after fix) |

**Investigation:**
- What does branch loader preserve in `existing.position`?
- Is it screen-space from drag updates? Or world-space from hydration?
- Why does `hasWorldPosition: false` appear in logs?

---

## Affected Files

### Primary Files (Core Logic)

1. **`components/annotation-canvas-modern.tsx`**
   - Lines 1106-1115: Position determination logic (RECENTLY FIXED)
   - Lines 247-281: Main panel persistence useEffect (NEWLY ADDED)
   - Lines 1135-1155: handleCreatePanel for branch panels
   - **Role:** Rendering, panel creation, position calculation

2. **`lib/hooks/use-canvas-hydration.ts`**
   - Lines 444-460: Panel data structure (stores world-space)
   - Lines 451-452: Sets both position and worldPosition to world-space
   - Lines 420-504: applyPanelLayout (converts world→screen, stores world)
   - **Role:** Loads persisted state, populates stores with world-space coords

3. **`components/canvas/canvas-context.tsx`**
   - Lines 368-445: Branch loader logic (CRITICAL)
   - Lines 389-414: Preserves existing data from hydration (SUPPOSED TO)
   - Lines 426-441: Conditional update logic (ATTEMPTED FIX)
   - **Role:** Loads branch annotations, may overwrite hydrated positions

4. **`lib/hooks/use-panel-persistence.ts`**
   - Lines 203-260: persistPanelCreate (converts screen→world, saves to DB)
   - Lines 88-98: persistPanelUpdate (stores both screen + world)
   - **Role:** Saves panel state to database

### Supporting Files

5. **`lib/canvas/coordinate-utils.ts`**
   - worldToScreen(), screenToWorld() conversion functions
   - **Role:** Coordinate system conversion

6. **`lib/data-store.ts`**
   - Lines 19-24: update() method (merges existing with updates)
   - **Role:** In-memory state management

7. **`app/api/canvas/layout/[noteId]/route.ts`**
   - GET endpoint: Fetches panel layout from database
   - **Role:** Hydration data source

8. **`app/api/canvas/panels/route.ts`**
   - POST endpoint: Saves panel to database
   - **Role:** Persistence data sink

### Reference Documents

9. **`docs/proposal/canvas_state_persistence/implementation.md`**
   - Lines 86-87: "All client stores hold world-space position/size values"
   - Lines 97: "Components treat store values as world-space"
   - Lines 224: "First panel insert persists immediately"
   - **Role:** Authoritative architectural specification

10. **`docs/proposal/canvas_state_persistence/COMPLETE_FIX_VERIFICATION.md`**
    - Previous fix verification document
    - **Role:** Historical context of fixes applied

---

## Investigation Commands

### Database Queries
```bash
# Check main panel positions (working)
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, position_x_world, position_y_world, created_at
   FROM panels WHERE panel_id='main' ORDER BY updated_at DESC LIMIT 5;"

# Check branch panel positions (failing)
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, position_x_world, position_y_world, created_at
   FROM panels WHERE type='annotation' ORDER BY updated_at DESC LIMIT 10;"

# Check for panels with zero/default positions (likely bugs)
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, note_id, type, position_x_world, position_y_world
   FROM panels WHERE position_x_world = 0 OR position_y_world = 0;"
```

### Debug Log Queries
```bash
# Hydration timeline
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, created_at, metadata
   FROM debug_logs WHERE component='CanvasHydration'
   ORDER BY created_at DESC LIMIT 20;"

# Branch loader timeline
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, created_at, metadata
   FROM debug_logs WHERE component='CanvasContext'
   ORDER BY created_at DESC LIMIT 20;"

# Position determination
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, created_at, metadata
   FROM debug_logs WHERE component='AnnotationCanvas' AND action='determining_panel_position'
   ORDER BY created_at DESC LIMIT 10;"

# Complete timeline (all components)
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, created_at, metadata->>'panelId' as panel_id
   FROM debug_logs
   WHERE component IN ('CanvasHydration', 'CanvasContext', 'AnnotationCanvas', 'PanelPersistence')
   ORDER BY created_at DESC LIMIT 50;"
```

---

## Expected Outcomes

### If Hypothesis 1 is Correct (Race Condition):
- **Finding:** Branch loader timestamp consistently < hydration timestamp
- **Fix:** Make branch loader wait for hydration, or don't let it touch position data at all
- **Implementation:** Add hydration status check in canvas-context.tsx

### If Hypothesis 2 is Correct (Coordinate Confusion):
- **Finding:** Branch panels have screen-space coords in position field
- **Fix:** Ensure ALL stores hold world-space coords (per implementation.md)
- **Implementation:** Already attempted in latest fixes (lines 1109-1115)

### If Hypothesis 3 is Correct (Branch Loader Overwrites):
- **Finding:** Branch loader removes worldPosition field when updating
- **Fix:** Branch loader should NEVER touch position/worldPosition fields
- **Implementation:** Already attempted (canvas-context.tsx lines 389-441)

### If Hypothesis 4 is Correct (Different Code Paths):
- **Finding:** Main panel has additional safeguards that branch panels lack
- **Fix:** Apply same persistence pattern to both panel types
- **Implementation:** Add similar useEffect for branch panel persistence

---

## Success Criteria

Research is complete when we can answer:

1. ✅ **What is the exact root cause?** (Verified with debug logs and database queries)
2. ✅ **Why does main panel work but branch panels fail?** (Code path comparison complete)
3. ✅ **What coordinates are being saved?** (Database verification complete)
4. ✅ **What coordinates are being loaded?** (Hydration logs analyzed)
5. ✅ **Where is the data being corrupted?** (Timeline analysis identifies the exact step)
6. ✅ **What is the correct fix?** (Based on implementation.md architecture)

---

## Next Steps After Research

1. **Document findings** in `BRANCH_PANEL_PERSISTENCE_RESEARCH_RESULT.md`
2. **Create fix proposal** with specific code changes
3. **Implement fix** following implementation.md architecture
4. **Verify fix** with manual testing and debug logs
5. **Update COMPLETE_FIX_VERIFICATION.md** with final status

---

## Timeline

- **Phase 1 (Database Verification):** 15 minutes
- **Phase 2 (Execution Flow):** 30 minutes
- **Phase 3 (Debug Logs):** 30 minutes
- **Phase 4 (Code Comparison):** 30 minutes
- **Phase 5 (Coordinate Audit):** 30 minutes
- **Total Estimated Time:** 2-3 hours

---

## References

- **Implementation Plan:** `/docs/proposal/canvas_state_persistence/implementation.md`
- **Architecture Spec:** Lines 86-87, 97, 224 (world-space requirement)
- **Previous Fixes:** `COMPLETE_FIX_VERIFICATION.md`
- **Debug Logging Guide:** `codex/how_to/debug_logs.md`
- **Coordinate Utils:** `lib/canvas/coordinate-utils.ts`

---

## Notes

- This research plan follows CLAUDE.md requirements:
  - Uses debug logs for investigation (per mandatory policy)
  - Verifies against implementation.md (authoritative source)
  - Checks database state with actual queries (no assumptions)
  - Traces complete execution flow (no guessing)
  - Identifies affected files explicitly
- All hypotheses will be tested with concrete evidence (debug logs, DB queries, code inspection)
- No claims will be made without verification (per honesty policy)
