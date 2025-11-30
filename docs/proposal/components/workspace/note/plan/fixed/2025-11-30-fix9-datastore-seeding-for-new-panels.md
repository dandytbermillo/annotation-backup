# FIX 9: DataStore Seeding for Dynamically Created Panels

**Date:** 2025-11-30
**Status:** Implemented and Verified
**File Modified:** `lib/hooks/annotation/use-canvas-note-sync.ts` (lines 313-346)

---

## Problem Description

When clicking the "+ Note" button to add new notes in a workspace, the notes appeared in the workspace toolbar but **did not render on the canvas**. The panel was added to `canvasItems` but remained invisible.

## Symptoms Observed

1. User creates notes, calculators, and timers in the default workspace
2. User creates a new workspace and adds notes
3. User switches back to the default workspace
4. Existing notes are visible
5. User clicks "+ Note" button to add a new note
6. **Note appears in workspace toolbar** (5 entries shown)
7. **Only 1 note visible on canvas** (4 notes missing)
8. No error messages in console

## Root Cause Analysis

### Investigation Process

1. **Analyzed debug logs** in database:
   ```sql
   SELECT component, action, metadata
   FROM debug_logs
   WHERE component IN ('AnnotationCanvas', 'WidgetStudioConnections', 'PanelsRenderer')
   ORDER BY created_at DESC LIMIT 50;
   ```

2. **Found `branch_not_found` errors** for 4 of 5 notes in WidgetStudioConnections
3. **Only 1 note had `branch_found`** - the original note created before workspace switch
4. **Traced the rendering path** from `useCanvasNoteSync` → `canvasItems` → `PanelsRenderer`

### The Bug Flow

```
T+0ms:    User clicks "+ Note" button
T+10ms:   useCanvasNoteSync.setCanvasItems creates new panel item
T+11ms:   Panel added to canvasItems state with storeKey "noteId:main"
T+20ms:   React re-renders, PanelsRenderer receives new canvasItems
T+21ms:   PanelsRenderer calls dataStore.get(storeKey)
T+22ms:   dataStore.get() returns NULL ← BUG: DataStore not populated
T+23ms:   PanelsRenderer returns null for this panel
T+24ms:   Panel not rendered ❌ INVISIBLE NOTE
```

### Root Cause Identified

When `useCanvasNoteSync` creates a new panel (lines 309-310), it:
1. Creates the panel item with `createPanelItem()`
2. Adds it to `canvasItems` via `setCanvasItems()`

But **no code populates the DataStore** for that panel's `storeKey`.

When `PanelsRenderer` attempts to render:
```typescript
// panels-renderer.tsx lines 101-109
const branch = isPlainMode ? dataStore.get(storeKey) : branchesMap?.get(storeKey)
if (!branch) {
  console.warn(`[PanelsRenderer] Branch ${panelId} not found...`)
  return null  // ← Panel not rendered when dataStore has no entry
}
```

### Why It Wasn't Caught Before

The `useDefaultMainPanelPersistence` hook was supposed to seed the DataStore, but it has a guard:

```typescript
// use-default-main-panel-persistence.ts line 62
if (!hydrationStatus.success) return
```

For dynamically added notes, hydration gets interrupted during workspace switches, so `hydrationStatus.success` is never `true` and the hook bails out without seeding the DataStore.

---

## The Fix

### Solution: Seed DataStore Immediately When Creating Panel

Added DataStore seeding in `useCanvasNoteSync` immediately after creating a new panel:

```typescript
// lib/hooks/annotation/use-canvas-note-sync.ts lines 313-346

nextMainItems.push(
  createPanelItem("main", targetPosition, "main", id, targetStoreKey),
)

// FIX 9: Seed DataStore immediately when creating new panel.
// Without this, PanelsRenderer calls dataStore.get(storeKey) and gets null,
// causing the panel to not render even though it's in canvasItems.
// Previously, useDefaultMainPanelPersistence was supposed to do this,
// but it depends on hydrationStatus.success which never fires for
// dynamically added notes (hydration gets interrupted).
if (dataStore && !dataStore.get(targetStoreKey)) {
  dataStore.set(targetStoreKey, {
    id: "main",
    type: "main" as const,
    title: "",
    position: targetPosition,
    worldPosition: targetPosition,
    dimensions: { width: 420, height: 350 },
    originalText: "",
    isEditable: true,
    branches: [],
    parentId: null,
    content: undefined,
    preview: "",
    hasHydratedContent: false,
    state: "active",
    closedAt: null,
  })
  debugLog({
    component: "AnnotationCanvas",
    action: "noteIds_sync_seeded_datastore",
    metadata: {
      noteId: id,
      storeKey: targetStoreKey,
      position: targetPosition,
    },
  })
}
```

### How It Works

1. **Panel created**: `createPanelItem()` creates the canvas item
2. **Check DataStore**: Is there already an entry for this `storeKey`?
3. **Seed if missing**: If DataStore has no entry, create one with default main panel data
4. **Log for debugging**: Emit `noteIds_sync_seeded_datastore` for verification
5. **PanelsRenderer succeeds**: `dataStore.get(storeKey)` now returns valid data

### Why This Is Safe

- **Existing panels**: Check `!dataStore.get(targetStoreKey)` prevents overwriting existing data
- **Workspace switches**: DataStore is workspace-scoped, so each workspace gets its own seeding
- **Matches existing structure**: Data structure mirrors `canvas-context.tsx` lines 366-381
- **Idempotent**: Can run multiple times without side effects

---

## Verification

### Debug Log Evidence

After applying the fix, tested with reproduction steps. Logs show DataStore seeding:

```sql
SELECT action, metadata->>'noteId' as note_id, metadata->>'storeKey' as store_key, created_at
FROM debug_logs
WHERE action = 'noteIds_sync_seeded_datastore'
ORDER BY created_at DESC LIMIT 10;
```

Results showed seeding for all new notes:

| Time | Note ID | Store Key |
|------|---------|-----------|
| 05:31:31 | 3d0c5f45-... | 3d0c5f45-...:main |
| 05:31:08 | f4e92a11-... | f4e92a11-...:main |
| 05:30:55 | b8c7d6e9-... | b8c7d6e9-...:main |

### Branch Found Verification

Before fix:
```sql
-- 4 of 5 notes had branch_not_found
SELECT COUNT(*) FROM debug_logs WHERE action = 'branch_not_found' AND created_at > NOW() - INTERVAL '30 minutes';
-- Result: 4
```

After fix:
```sql
-- All notes have branch_found
SELECT COUNT(*) FROM debug_logs WHERE action = 'branch_not_found' AND created_at > NOW() - INTERVAL '30 minutes';
-- Result: 0

SELECT COUNT(*) FROM debug_logs WHERE action = 'branch_found' AND created_at > NOW() - INTERVAL '30 minutes';
-- Result: 8
```

### User Testing Results

After FIX 9:
- Created notes, calculators, timers in default workspace ✓
- Created new workspace with notes, timers, calculators ✓
- Switched between workspaces repeatedly ✓
- All notes visible on canvas ✓
- Timers and calculators persist and run in background ✓
- **"+ Note" button works correctly** - new notes render immediately ✓
- Can add unlimited notes from "+ Note" button ✓

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/hooks/annotation/use-canvas-note-sync.ts` | 313-346 | Added FIX 9 DataStore seeding for new panels |

---

## Debug Query

To check if the seeding is working:

```sql
SELECT action,
       metadata->>'noteId' as note_id,
       metadata->>'storeKey' as store_key,
       metadata->>'position' as position,
       created_at
FROM debug_logs
WHERE action = 'noteIds_sync_seeded_datastore'
ORDER BY created_at DESC
LIMIT 20;
```

To verify no branch_not_found errors:

```sql
SELECT action,
       metadata->>'panelId' as panel_id,
       metadata->>'storeKey' as store_key,
       created_at
FROM debug_logs
WHERE action = 'branch_not_found'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## Related Fixes

- **FIX 6** (use-note-workspaces.ts lines 2249-2278): Hot runtime protection for openNotes in replayWorkspaceSnapshot
- **FIX 7** (use-note-workspaces.ts lines 2296-2298): Extend targetIds to prevent close loop from undoing FIX 6
- **FIX 8** (use-note-workspaces.ts lines 2130-2147): Reject empty snapshots in previewWorkspaceFromSnapshot
- **FIX 9** (use-canvas-note-sync.ts lines 313-346): DataStore seeding for dynamically created panels (this fix)

---

## Lessons Learned

1. **Follow the rendering chain**: When something doesn't render, trace the full path from state creation to DOM
2. **DataStore is the source of truth for rendering**: `canvasItems` defines what SHOULD render, but DataStore provides the data to ACTUALLY render
3. **Hydration timing is tricky**: Hooks that depend on `hydrationStatus.success` may not run for dynamically added items
4. **Check both container and data**: A panel can be in `canvasItems` but still not render if DataStore lacks the entry
5. **Debug logging reveals timing issues**: The `branch_not_found` logs immediately pointed to the DataStore gap

---

## Prevention of Similar Issues

For future features:
1. **Always seed DataStore when creating items**: Don't assume other hooks will populate it
2. **Check the full render path**: state → canvasItems → PanelsRenderer → dataStore.get() → render
3. **Test dynamic item creation**: Create items both at startup and after workspace switches
4. **Add branch_found/branch_not_found logging**: Makes DataStore gaps immediately visible
5. **Be wary of hydration dependencies**: Code that depends on hydration may not run for all items

---

## Code Structure Note

The DataStore structure in the fix mirrors `canvas-context.tsx` lines 366-381. If this structure changes, both locations need updating. Consider extracting to a shared factory:

```typescript
// Potential future refactor: lib/canvas/create-default-main-panel-data.ts
export function createDefaultMainPanelData(position: { x: number; y: number }) {
  return {
    id: "main",
    type: "main" as const,
    title: "",
    position,
    worldPosition: position,
    dimensions: { width: 420, height: 350 },
    originalText: "",
    isEditable: true,
    branches: [],
    parentId: null,
    content: undefined,
    preview: "",
    hasHydratedContent: false,
    state: "active",
    closedAt: null,
  }
}
```

This would prevent drift between the two locations.
