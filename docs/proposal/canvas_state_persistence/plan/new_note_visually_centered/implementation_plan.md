# Canvas – Predictable Centered Spawn for New Notes

## Objective
When a user creates a note via the floating toolbar's "+ Note" button, the new panel should appear *visually centered* within the portion of the canvas the user is looking at. The rest of the layout (existing panels, connection lines, camera position) must remain untouched. The only movement we allow is a small nudge to keep the new panel fully in view. The panel should receive a brief highlight so it is immediately discoverable.

---

## Current Behaviour (2025-10-24)
- `handleNoteSelect` opens the note without panning, but when no position is provided the workspace still falls back to the legacy `{ x: 2000, y: 1500 }` seed.
- The first render therefore lands near the minimap; hydration later corrects it, producing the "off-screen then snap" behaviour.
- Canvas provider and workspace caching both persist the legacy default, so reloading restores the same off-screen location.

---

## ROOT CAUSE ANALYSIS (2025-10-26)

After extensive investigation and multiple fix attempts, we discovered **THREE separate bugs** that were independently causing notes to appear at the legacy position `{ x: 2000, y: 1500 }` instead of the computed viewport-centered position.

### The Calculation Was Always Correct

The viewport-to-world coordinate conversion was **always working correctly**:

```
Formula: worldX = (screenX - cameraTranslateX) / cameraZoom - panelWidth/2
```

When the user clicked "+ Note", the system correctly calculated positions like `{ x: 1210, y: 640 }` based on the current viewport. The problem was that this correct position was being **overwritten by hardcoded fallbacks** in three different places.

---

### Bug #1: Position Lookup Priority (resolveWorkspacePosition)

**File:** `components/annotation-canvas-modern.tsx` (line 271)
**Function:** `resolveWorkspacePosition()`

#### The Problem

The position lookup function checked values in the wrong order:

1. **First:** Check `pendingPosition` (stale cache) → Returned `{ x: 2000, y: 1500 }`
2. **Second:** Check `cachedPosition` (stale cache) → Returned `{ x: 2000, y: 1500 }`
3. **Last:** Check `workspaceEntry.mainPosition` (fresh computed value) → **NEVER REACHED**

Even though `openWorkspaceNote()` stored the correct position `{ x: 1210, y: 640 }` in `workspaceEntry.mainPosition`, the lookup function returned stale cached values before ever checking the workspace entry.

**Analogy:** GPS checking "recent destinations" before checking the destination you just typed in.

#### The Fix

Changed the priority order to check fresh workspace position FIRST:

1. **First:** Check `workspaceEntry.mainPosition` (fresh computed value) → Returns `{ x: 1210, y: 640 }` ✅
2. **Second:** Check `pendingPosition` (only as fallback)
3. **Third:** Check `cachedPosition` (only as fallback)

**Lines Changed:** 271-326

---

### Bug #2: Provider Initialization Default

**File:** `components/annotation-canvas-modern.tsx` (line 1559)
**Function:** `useEffect(() => { provider.initializeDefaultData(...) }, [noteId])`

#### The Problem

When initializing the YJS provider for a new note, the default data included a **hardcoded position**:

```typescript
const defaultData = {
  'main': {
    position: { x: 2000, y: 1500 },  // ← HARDCODED LEGACY POSITION
    // ... other fields
  }
}
provider.initializeDefaultData(noteId, defaultData)
```

Even though Bug #1 was fixed and `resolveWorkspacePosition()` now returned the correct position, the provider was being initialized with the hardcoded legacy position, which **overwrote** the correct value.

**Analogy:** Restaurant has your old address hardcoded in their system, so delivery goes to the wrong place even though you provided the correct address.

#### The Fix

Use `workspaceMainPosition` (which comes from the fixed `resolveWorkspacePosition()`) instead of hardcoded value:

```typescript
const initialPosition = workspaceMainPosition ?? getDefaultMainPosition()
const defaultData = {
  'main': {
    position: initialPosition,  // ← Uses computed position from Bug #1 fix
    // ... other fields
  }
}
provider.initializeDefaultData(noteId, defaultData)
```

**Lines Changed:** 1552-1586

---

### Bug #3: Panel Rendering Fallback

**File:** `components/annotation-canvas-modern.tsx` (line 3511)
**Function:** `PanelsRenderer` (panel rendering loop)

#### The Problem

When rendering panels to the screen, the code checked positions in the wrong order:

```typescript
const position = branch.position || { x: 2000, y: 1500 }  // ← Fallback applied immediately
const workspacePosition = resolveWorkspacePosition?.(panelNoteId)  // ← Computed but never used!
```

For new panels, `branch.position` was `null`, so it immediately fell back to `{ x: 2000, y: 1500 }`. The `workspacePosition` was computed AFTER the fallback was applied, so it was never actually used for positioning.

**Analogy:** Taxi driver sees your destination is empty, so drives to default location instead of checking the destination system.

#### The Fix

Compute `workspacePosition` FIRST and use it for the final position:

```typescript
const workspacePosition = resolveWorkspacePosition?.(panelNoteId)  // ← Compute first
const position = workspacePosition ?? branch.position ?? getDefaultMainPosition()  // ← Use it first
```

**Lines Changed:** 3511-3526

---

## WHY ALL THREE BUGS MATTERED

Each bug **independently** caused notes to appear at `{ x: 2000, y: 1500 }`:

### Scenario 1: Only Bug #1 Fixed
- ✅ Position lookup returns `{ x: 1210, y: 640 }`
- ❌ Provider init uses hardcoded `{ x: 2000, y: 1500 }` (Bug #2) → Note initialized at wrong position
- ❌ Rendering uses fallback `{ x: 2000, y: 1500 }` (Bug #3) → Note drawn at wrong position
- **Result:** Note appears at `{ x: 2000, y: 1500 }` ❌

### Scenario 2: Bugs #1 and #2 Fixed
- ✅ Position lookup returns `{ x: 1210, y: 640 }`
- ✅ Provider init uses `{ x: 1210, y: 640 }`
- ❌ Rendering uses fallback `{ x: 2000, y: 1500 }` (Bug #3) → Note drawn at wrong position
- **Result:** Note appears at `{ x: 2000, y: 1500 }` ❌

### Scenario 3: ALL THREE BUGS FIXED
- ✅ Position lookup returns `{ x: 1210, y: 640 }`
- ✅ Provider init uses `{ x: 1210, y: 640 }`
- ✅ Rendering uses `{ x: 1210, y: 640 }`
- **Result:** Note appears at `{ x: 1210, y: 640 }` ✅

**All three bugs had to be fixed for the feature to work.**

---

## THE FIX PATTERN

All three bugs followed the same anti-pattern: **Checking fallback/default values BEFORE fresh computed values**

### The Anti-Pattern (Before):
```
Check old/cached/default value FIRST
  ↓
If found, use it immediately
  ↓
Never check the fresh, correct value
```

### The Correct Pattern (After):
```
Check fresh workspace value FIRST
  ↓
If found, use it
  ↓
Only use old/cached/default as FALLBACK if fresh value doesn't exist
```

---

## Proposed Behaviour

1. Do **not** pan the camera.
2. Place the new panel so it feels centered in the current viewport. Prefer the user's last interaction point or the viewport midpoint, but add small nudges (and diagonal offsets for rapid creation) so the panel is fully visible without overlapping existing panels.
3. Apply a brief "new note" highlight (existing glow utility or light animation) so the user's attention stays on the new panel.

---

## Implementation Plan

### 1. ✅ COMPLETED: Viewport-Centered Position Calculation

**File:** `components/annotation-app.tsx` (lines 1401-1444)
**Function:** `handleNoteSelect()`

#### What Was Implemented

Simple, direct screen-to-world coordinate conversion based on the infinite-canvas-main approach:

```typescript
// Get viewport center in screen coordinates
const viewportCenterX = window.innerWidth / 2
const viewportCenterY = window.innerHeight / 2

// Convert to world coordinates accounting for camera transform
const PANEL_WIDTH = 500
const PANEL_HEIGHT = 400
const worldX = (viewportCenterX - camera.translateX) / camera.zoom - PANEL_WIDTH / 2
const worldY = (viewportCenterY - camera.translateY) / camera.zoom - PANEL_HEIGHT / 2

resolvedPosition = { x: worldX, y: worldY }
```

**Key Points:**
- ✅ Synchronous calculation (no async operations)
- ✅ No caching (computes fresh every time)
- ✅ Uses current camera state directly
- ✅ Accounts for zoom level
- ✅ Centers panel (not just top-left corner)

---

### 2. ✅ COMPLETED: Fix Position Lookup Priority

**File:** `components/annotation-canvas-modern.tsx` (lines 271-326)
**Function:** `resolveWorkspacePosition()`

#### What Was Changed

Reversed the priority order to check fresh workspace positions before stale cached positions:

**Before:**
1. Check `pendingPosition` (stale cache)
2. Check `cachedPosition` (stale cache)
3. Check `workspaceEntry.mainPosition` (fresh value) ← Never reached

**After:**
1. Check `workspaceEntry.mainPosition` (fresh value) ← Used first ✅
2. Check `pendingPosition` (fallback only)
3. Check `cachedPosition` (fallback only)

**Added:**
- Comprehensive debug logging for each position source
- Clear metadata showing which source was used

---

### 3. ✅ COMPLETED: Fix Provider Initialization

**File:** `components/annotation-canvas-modern.tsx` (lines 1552-1586)
**Function:** `useEffect(() => { provider.initializeDefaultData(...) }, [noteId])`

#### What Was Changed

**Before:**
```typescript
const defaultData = {
  'main': {
    position: { x: 2000, y: 1500 },  // ← Hardcoded legacy position
    // ...
  }
}
```

**After:**
```typescript
const initialPosition = workspaceMainPosition ?? getDefaultMainPosition()
const defaultData = {
  'main': {
    position: initialPosition,  // ← Uses computed viewport-centered position
    // ...
  }
}
```

**Added:**
- Debug logging for provider initialization position
- Uses `workspaceMainPosition` which comes from the fixed `resolveWorkspacePosition()`

---

### 4. ✅ COMPLETED: Fix Panel Rendering Priority

**File:** `components/annotation-canvas-modern.tsx` (lines 3511-3526)
**Function:** `PanelsRenderer` (rendering loop)

#### What Was Changed

**Before:**
```typescript
const position = branch.position || { x: 2000, y: 1500 }  // ← Fallback first
const workspacePosition = resolveWorkspacePosition?.(panelNoteId)  // ← Never used
```

**After:**
```typescript
const workspacePosition = resolveWorkspacePosition?.(panelNoteId)  // ← Compute first
const position = workspacePosition ?? branch.position ?? getDefaultMainPosition()  // ← Use first
```

**Added:**
- Debug logging for position resolution showing all sources
- Clear priority: workspace → branch → default

---

### 5. ✅ COMPLETED: Comprehensive Debug Logging

**Added throughout all affected functions:**

- `new_note_camera_state` - Camera state when computing position
- `new_note_viewport_centered` - Final computed position with formula
- `calling_openWorkspaceNote` - What's being passed to workspace
- `resolve_workspace_position_from_entry` - Position from workspace entry
- `resolve_workspace_position_from_pending` - Position from pending cache
- `resolve_workspace_position_from_cache` - Position from cache
- `provider_init_position` - Position used for provider initialization
- `panel_position_resolution` - Position sources during rendering

---

### 6. Remove immediate camera panning for new notes

**Status:** Already implemented (disabled in earlier work)

**File:** `components/annotation-app.tsx`
- `centerNoteOnCanvas` disabled for creation/reselection
- Users can re-center manually via the minimap or future affordances

---

### 7. Highlight the fresh panel

**Status:** To be implemented (optional enhancement)

**Files:** `components/annotation-canvas-modern.tsx` (or shared highlight utility)
- After the new panel is inserted into `canvasItems` within `handleNoteHydration`, emit `workspace:highlight-note` so the glow animation runs once
- Emit a `debugLog` (`new_note_highlight_triggered`) for verification
- Maintain a short-lived ref (e.g., `newlyCreatedNoteRef`) so the event fires only once per newly spawned note

---

### 8. Guardrails / Edge Cases

#### ✅ COMPLETED: Null Safety in Calculation

**File:** `components/annotation-app.tsx` (lines 1425-1426)

Added null coalescing operators to prevent NaN values:

```typescript
const worldX = (viewportCenterX - (currentCamera.translateX ?? 0)) / (currentCamera.zoom ?? 1) - PANEL_WIDTH / 2
const worldY = (viewportCenterY - (currentCamera.translateY ?? 0)) / (currentCamera.zoom ?? 1) - PANEL_HEIGHT / 2
```

#### 🔲 TODO: Rapid Creation Offset

When computing the world-space spawn point, add a small offset for rapid consecutive creations (e.g., `index * 50px` diagonally) so notes don't perfectly overlap if the user spams "+ Note".

**Status:** Deferred (existing `newNoteSequenceRef` infrastructure exists but offset logic needs implementation)

#### 🔲 TODO: Canvas Bounds Clamping

Clamp the computed world position to safe bounds to avoid spawning panels in unreachable areas:

```typescript
const CANVAS_SAFE_BOUNDS = { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 }

const clampPosition = (pos: { x: number; y: number }) => ({
  x: Math.max(CANVAS_SAFE_BOUNDS.minX, Math.min(CANVAS_SAFE_BOUNDS.maxX, pos.x)),
  y: Math.max(CANVAS_SAFE_BOUNDS.minY, Math.min(CANVAS_SAFE_BOUNDS.maxY, pos.y)),
})
```

**Status:** Deferred (bounds exist in `lib/canvas/visual-centering.ts` but not used in main flow)

#### 🔲 TODO: Collaboration Mode Support

When collaboration mode (Yjs) is active, ensure the initial position is broadcast via the provider so other clients see the new panel in the same spot.

**Status:** Out of scope for Option A (single-user, offline-first mode)

---

## ACTUAL SOLUTION SUMMARY

### The Core Issue

The viewport-centered position calculation was **always correct**, but the correct values were being **overwritten by hardcoded fallbacks** at three different stages of the pipeline:

1. **Position Lookup** - Returned stale cached `{ x: 2000, y: 1500 }` instead of fresh computed position
2. **Provider Init** - Initialized with hardcoded `{ x: 2000, y: 1500 }` instead of workspace position
3. **Panel Rendering** - Used fallback `{ x: 2000, y: 1500 }` instead of workspace position

### The Solution

**Changed all three to prioritize fresh workspace positions over fallbacks:**

1. **Position Lookup** - Check `workspaceEntry.mainPosition` FIRST
2. **Provider Init** - Use `workspaceMainPosition` instead of hardcoded value
3. **Panel Rendering** - Check `workspacePosition` FIRST before fallback

### Files Changed

- `components/annotation-app.tsx` (lines 1401-1444, 1497-1514) - Calculation and debug logging
- `components/annotation-canvas-modern.tsx` (lines 271-326) - Position lookup priority
- `components/annotation-canvas-modern.tsx` (lines 1552-1586) - Provider initialization
- `components/annotation-canvas-modern.tsx` (lines 3511-3526) - Panel rendering priority

### Type Check Status

✅ All changes compile successfully with `npm run type-check`

---

## Testing

### Manual Testing Required

1. **Test 1: New Note at Origin**
   - Reset canvas view to origin (translateX: 0, translateY: 0, zoom: 1)
   - Click "+ Note"
   - **Expected:** Note appears centered in viewport

2. **Test 2: New Note After Pan**
   - Pan canvas to different location
   - Click "+ Note"
   - **Expected:** Note appears centered in CURRENT viewport (not at origin)

3. **Test 3: New Note After Zoom**
   - Zoom in or out
   - Pan to different location
   - Click "+ Note"
   - **Expected:** Note appears centered at current zoom level

4. **Test 4: Rapid Creation**
   - Click "+ Note" 5 times rapidly
   - **Expected:** All notes appear near viewport center (not at legacy position)
   - **NOT Expected:** Notes alternating between centered and off-screen

5. **Test 5: Existing Note Persistence**
   - Create a note, move it to a custom position
   - Close and reopen the note
   - **Expected:** Note appears where you moved it (persisted position works)

### Debug Log Verification

```sql
-- Check position calculation
SELECT metadata->>'noteId' as note,
       metadata->'worldPosition' as computed_pos,
       metadata->'camera' as camera
FROM debug_logs
WHERE component = 'AnnotationApp'
  AND action = 'new_note_viewport_centered'
ORDER BY created_at DESC LIMIT 10;

-- Check position lookup source
SELECT metadata->>'targetNoteId' as note,
       metadata->>'source' as lookup_source,
       metadata->'position' as position
FROM debug_logs
WHERE component = 'AnnotationCanvas'
  AND action LIKE 'resolve_workspace_position%'
ORDER BY created_at DESC LIMIT 10;

-- Check provider initialization
SELECT metadata->>'noteId' as note,
       metadata->'workspaceMainPosition' as workspace_pos,
       metadata->'initialPosition' as init_pos
FROM debug_logs
WHERE component = 'AnnotationCanvas'
  AND action = 'provider_init_position'
ORDER BY created_at DESC LIMIT 10;

-- Check panel rendering
SELECT metadata->>'panelId' as panel,
       metadata->'workspacePosition' as workspace_pos,
       metadata->'finalPosition' as final_pos
FROM debug_logs
WHERE component = 'AnnotationCanvas'
  AND action = 'panel_position_resolution'
ORDER BY created_at DESC LIMIT 10;
```

**Expected Results:**
- All positions should be viewport-centered, NOT `{ x: 2000, y: 1500 }`
- Lookup source should be `workspaceEntry.mainPosition` for new notes
- Provider init should use workspace position
- Panel rendering should use workspace position

### Unit Tests

- ✅ Transform utilities already tested
- 🔲 TODO: Add specific tests for position priority resolution
- 🔲 TODO: Add tests for edge cases (null camera, missing workspace entry)

---

## Acceptance Criteria

### Core Functionality
- [ ] **New notes appear centered** - Visual verification required
- [ ] **No legacy positions** - Debug logs show no `{ x: 2000, y: 1500 }`
- [ ] **Position source is workspace** - Debug logs show `workspaceEntry.mainPosition`
- [ ] **Works after pan** - Notes centered in current view, not origin
- [ ] **Works after zoom** - Notes centered at current zoom level
- [ ] **Rapid creation works** - No alternating centered/off-screen behavior

### Non-Regression
- [ ] **Existing notes unaffected** - Reopening notes uses persisted positions
- [ ] **Camera doesn't move** - Viewport stays at user's current position
- [ ] **No errors in console** - No TypeScript or runtime errors

### Technical Quality
- [x] **Type-check passes** - `npm run type-check` succeeds
- [x] **Debug logging added** - All position sources logged
- [ ] **Integration tests pass** - When implemented

---

## Status

**Implementation:** ✅ COMPLETE (2025-10-26)
**Testing:** ⏳ AWAITING USER VERIFICATION
**Type Check:** ✅ PASSING

---

## Related Documents

1. **infinite-canvas analysis:** `/docs/analysis-infinite-canvas-centering.md`
2. **First attempt:** `/docs/proposal/canvas_state_persistence/fixing_doc/2025-10-26-infinite-canvas-approach-implementation.md`
3. **Second attempt:** `/docs/proposal/canvas_state_persistence/fixing_doc/2025-10-26-REAL-FIX-position-priority-bug.md`
4. **Final fix:** `/docs/proposal/canvas_state_persistence/fixing_doc/2025-10-26-FINAL-FIX-hardcoded-legacy-positions.md`

---

Saved: 2025-10-26
Owner: Canvas Platform Team
Status: Implementation Complete, Awaiting Verification
