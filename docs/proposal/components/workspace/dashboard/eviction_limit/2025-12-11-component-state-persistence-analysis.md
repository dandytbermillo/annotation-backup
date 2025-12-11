# Component State Persistence During Workspace Eviction - Analysis

**Date**: 2025-12-11
**Status**: UNRESOLVED
**Feature Slug**: `eviction_limit`

---

## Problem Statement

Timer/Calculator component state is lost when workspaces are evicted due to `maxRuntimes` limit (default: 4).

**Expected**: Set timer to 03:00, create 5+ workspaces (triggering eviction), switch back → timer shows 03:00
**Actual**: Timer shows default 05:00

---

## Root Cause: Cold Restore Race Condition

The fundamental problem is a **timing/race condition** during cold workspace restore. Components mount and auto-save their default state to the database **BEFORE** the persisted state can be loaded from DB.

### Timeline of Events During Cold Restore

```
T0: User clicks to switch to evicted workspace "summary14"
    │
    ▼
T1: handleSelectWorkspace(workspaceId) called
    - setPendingWorkspaceId(workspaceId)
    - Various state changes trigger React re-render
    │
    ▼
T2: React mounts workspace canvas and components
    - Timer component mounts with state=undefined
    - Timer defaults to { minutes: 5, seconds: 0 }
    - useComponentRegistration writes defaults to runtime ledger
    │
    ▼
T3: components_changed watcher fires
    - Detects ledger has data
    - Calls persistWorkspaceById()
    - SAVES { minutes: 5 } TO DATABASE  ← Problem!
    │
    ▼
T4: Async DB load finally happens
    - loadWorkspace() fetches from DB
    - DB now has { minutes: 5 } (defaults, not persisted 03:00)
    - previewWorkspaceFromSnapshot populates ledger with DB data
    - Ledger now has { minutes: 5 }
    │
    ▼
T5: User sees timer at 05:00 (wrong!)
```

The key insight: **The async DB load (T4) happens AFTER components have already saved defaults (T3).**

---

## Fixes Attempted and Why They Failed

### Fix 1: markRuntimeActive - Don't Create Empty Runtime

**File**: `lib/workspace/runtime-manager.ts`
**What it did**: Changed `markRuntimeActive` to not create an empty runtime if one doesn't exist.

**Why it failed**: The issue isn't about empty runtimes. Components were mounting and writing to a runtime that was correctly created by `ensureRuntimePrepared`. This fix addressed a different concern (avoiding ghost runtimes during eviction).

---

### Fix 2: registerRuntimeComponent Metadata Preservation

**File**: `lib/workspace/runtime-manager.ts`
**What it did**: When re-registering a component, preserve existing metadata instead of overwriting with undefined.

**Why it failed**: The metadata wasn't being "overwritten" by re-registration. It was being written correctly the first time - but with default values (05:00) because the component mounted before DB data was available.

---

### Fix 3: Source Parameter for previewWorkspaceFromSnapshot

**File**: `lib/hooks/annotation/use-note-workspaces.ts`
**What it did**: Added `source: "cache" | "database"` parameter. For cold restores, skip populating the ledger from cache (which has stale data) and only populate from database.

**Why it failed**: This fix addressed the wrong stage of the problem. By the time `previewWorkspaceFromSnapshot` runs (T4), the damage is already done - components have already saved defaults to DB at T3. Even correctly distinguishing cache vs database source doesn't help when the database itself now contains the wrong data.

---

### Fix 4: REVISION_MISMATCH Retry Logic

**File**: `lib/hooks/annotation/use-note-workspaces.ts` (two functions)
**What it did**: When eviction persistence fails with `REVISION_MISMATCH`, fetch fresh revision from server and retry the save.

**Why it failed**: This fix ensured eviction saves don't fail due to revision conflicts. But the problem is **what data** is being saved, not whether the save succeeds. The eviction save was capturing data from:
- The capture function (`captureCurrentWorkspaceSnapshot`)
- Which read from LayerManager (stale) instead of runtime ledger
- Or worse, by the time eviction runs, the ledger might already have defaults

---

### Fix 5: Read from Runtime Ledger in captureCurrentWorkspaceSnapshot

**File**: `lib/hooks/annotation/use-note-workspaces.ts`
**What it did**: Changed `captureCurrentWorkspaceSnapshot` to read component metadata from runtime ledger first (authoritative source), with LayerManager as fallback.

**Why it failed**: This fix helps during eviction capture - the correct timer value (03:00) is now captured. But this doesn't help the cold restore race condition. When switching BACK to the evicted workspace:
1. The evicted workspace was correctly saved with 03:00 ✓
2. But during cold restore, components mount and save 05:00 to DB ✗
3. The persisted 03:00 is overwritten before it can be restored

---

### Fix 6: Delay setActiveWorkspaceContext for Cold Restores

**File**: `lib/hooks/annotation/use-note-workspaces.ts`
**What it did**: For cold restores, only call `setActiveWorkspaceContext(workspaceId)` AFTER DB data is loaded and runtime ledger is populated, not at the start.

**Why it failed**: `setActiveWorkspaceContext` is just one of many state changes that can trigger React re-renders and component mounting. Other triggers include:
- `setPendingWorkspaceId(workspaceId)`
- `setCurrentWorkspaceId(workspaceId)`
- `ensureRuntimePrepared()` creating the runtime
- `setRuntimeVisible()` changes
- `setWorkspaceNoteMembership()` changes

Even without `setActiveWorkspaceContext`, these other state changes cause the canvas and components to mount.

---

### Fix 7: Save Cooldown for Cold Restore (Current)

**File**: `lib/hooks/annotation/use-note-workspaces.ts`
**What it did**: At the very start of cold restore, set a 3-second save cooldown:
```typescript
skipSavesUntilRef.current.set(workspaceId, Date.now() + 3000)
```

Both `persistWorkspaceById` and `persistWorkspaceNow` check this cooldown and skip saves if within the window.

**Status**: Just implemented, not yet tested.

**Why it might work**: Unlike previous fixes that tried to prevent components from mounting with defaults or tried to fix the data source, this fix directly blocks the auto-save that overwrites persisted data. Even if components mount with 05:00 and write to the ledger, the save to DB is blocked.

**Why it might fail**:
1. The 3-second window might not be enough for slow DB loads
2. Other code paths might save without checking the cooldown
3. After cooldown expires, if the ledger still has 05:00 (not updated by DB load), a save will persist wrong data

---

## Key Architectural Issues

### 1. Component Registration Writes to Ledger Immediately

When a component mounts, `useComponentRegistration` immediately writes its state to the runtime ledger:

```typescript
// In component mount
registerRuntimeComponent(workspaceId, componentId, componentType, {
  position, size, zIndex, metadata: state  // state = defaults if undefined
})
```

There's no check for "am I mounting during a cold restore where persisted state exists?"

### 2. components_changed Effect Auto-Saves Aggressively

The `components_changed` watcher reacts to any ledger change and triggers saves:

```typescript
// Simplified
useEffect(() => {
  if (componentsChanged) {
    persistWorkspaceById(workspaceId, "components_changed")
  }
}, [panelSnapshotVersion, componentSnapshotVersion, ...])
```

This is good for capturing user edits quickly, but bad during restore when the ledger is being populated with defaults.

### 3. No "Restoration Mode" Flag

The codebase has `isHydratingRef` and `replayingWorkspaceRef` to suppress saves during initial load. But there's no equivalent for "cold restore in progress" - a state where we're restoring an evicted workspace and shouldn't trust ledger data until DB data is applied.

### 4. Async DB Load in Sync Render Flow

The architecture tries to make workspace switching feel instant by:
1. Immediately updating React state (shows loading/skeleton UI)
2. Async loading DB data in background
3. Applying data when ready

But components mount during step 1, before step 3 completes.

---

## Potential Solutions (Not Yet Implemented)

### Solution A: Component-Level Initial State from Ledger

Components should check the ledger BEFORE defaulting:

```typescript
// In Timer component
const existingState = getRuntimeComponentMetadata(workspaceId, componentId)
const [state, setState] = useState(existingState ?? DEFAULT_TIMER_STATE)
```

**Problem**: During cold restore, the ledger doesn't have the data yet (it's in DB).

### Solution B: Pre-populate Ledger Before Mounting

Load DB data and populate ledger BEFORE any state change that triggers mounting:

```typescript
// In handleSelectWorkspace for cold restore
const dbData = await loadWorkspace(workspaceId)  // Step 1: Load
populateRuntimeComponents(workspaceId, dbData.components)  // Step 2: Populate ledger
setActiveWorkspaceContext(workspaceId)  // Step 3: NOW mount components
```

**Problem**: This would add latency to workspace switching. The async load must complete before any UI feedback.

### Solution C: Cold Restore Mode Flag

Add a `coldRestoreInProgressRef` that:
1. Is set at the start of cold restore
2. Suppresses ALL saves for that workspace
3. Is cleared only after DB data is applied

```typescript
// At cold restore start
coldRestoreInProgressRef.current.set(workspaceId, true)

// In persist functions
if (coldRestoreInProgressRef.current.get(workspaceId)) {
  return // Skip save
}

// After DB load complete
coldRestoreInProgressRef.current.delete(workspaceId)
```

**This is essentially what Fix 7 does with the time-based cooldown, but time-based is fragile.**

### Solution D: Components Don't Write Defaults to Ledger

Change component registration to NOT write metadata on initial mount:

```typescript
registerRuntimeComponent(workspaceId, componentId, componentType, {
  position, size, zIndex,
  metadata: undefined  // Don't set defaults - let restore populate this
})
```

Only write metadata when user actually interacts (changes timer value).

**Problem**: This would require components to handle "no metadata in ledger" gracefully and might break other features.

---

## Files Modified During This Investigation

1. `lib/workspace/runtime-manager.ts`
   - `markRuntimeActive`: Don't create empty runtime
   - `registerRuntimeComponent`: Preserve existing metadata

2. `lib/hooks/annotation/use-note-workspaces.ts`
   - `previewWorkspaceFromSnapshot`: Added `source` parameter
   - `persistWorkspaceSnapshot`: Added REVISION_MISMATCH retry
   - `persistWorkspaceById`: Added REVISION_MISMATCH retry
   - `captureCurrentWorkspaceSnapshot`: Read from runtime ledger first
   - `handleSelectWorkspace`: Delayed `setActiveWorkspaceContext` for cold
   - `handleSelectWorkspace`: Added 3s save cooldown for cold restore

---

## Debug Logs to Look For

When testing, check these log actions in the `debug_logs` table:

```sql
-- Cold restore flow
SELECT * FROM debug_logs
WHERE action IN (
  'select_workspace_requested',
  'cold_restore_set_save_cooldown',
  'cold_restore_skip_cached_snapshot',
  'cold_restore_set_active_context',
  'preview_hot_runtime_ledger_decision'
)
ORDER BY created_at DESC LIMIT 50;

-- Save attempts during cold restore
SELECT * FROM debug_logs
WHERE action IN (
  'persist_by_id_start',
  'persist_by_id_skip_cooldown',
  'persist_by_id_success',
  'save_attempt',
  'save_success'
)
ORDER BY created_at DESC LIMIT 50;

-- Component data being saved
SELECT * FROM debug_logs
WHERE action = 'build_payload_components'
AND metadata::text LIKE '%timer%'
ORDER BY created_at DESC LIMIT 20;
```

---

## Next Steps

1. **Test Fix 7** (save cooldown) - See if 3s is enough and if it blocks the problematic saves

2. **If Fix 7 fails**: Consider implementing Solution C (explicit cold restore mode flag) instead of time-based cooldown

3. **Long-term**: Refactor to Solution B (pre-populate ledger before mounting) for a cleaner architecture

---

## Conclusion

The core issue is architectural: the system is designed for **instant UI feedback** (mount components immediately, load data async), but this creates a race condition where **default state overwrites persisted state**.

Each fix addressed a symptom without solving the fundamental timing problem. The most recent fix (save cooldown) directly blocks the problematic save, which is the most promising approach so far.
