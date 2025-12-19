# Phase 2: Unified Guards (Prevent Empty/Partial Overwrites)

**Date:** 2025-12-18
**Status:** Complete
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase implements the unified dirty tracking and guard infrastructure. The unified dirty check
function is now used in the eviction path, and the existing persistence guards are documented as
conforming to the unified policy.

---

## What Was Implemented

### 1. Unified Dirty Tracking Module

**File:** `lib/workspace/durability/dirty-tracking.ts`

Added functions that aggregate dirty state from both domains:

| Function | Purpose |
|----------|---------|
| `isWorkspaceDirty(workspaceId, dirtyRef)` | Boolean dirty check for both domains |
| `getWorkspaceDirtyState(workspaceId, dirtyRef)` | Detailed dirty state with per-domain breakdown |
| `clearWorkspaceDirty(workspaceId, dirtyRef)` | Clear dirty state in both domains |
| `getAllDirtyWorkspaceIds(dirtyRef, knownIds)` | Get all dirty workspaces for batch operations |

### 2. Eviction Path Updated

**File:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`

**Before (inline check):**
```typescript
const componentStoreDirty = workspaceHasDirtyState(targetWorkspaceId)
const workspaceLevelDirty = workspaceDirtyRef?.current?.has(targetWorkspaceId) ?? false
const isDirty = componentStoreDirty || workspaceLevelDirty
```

**After (unified check):**
```typescript
const dirtyState = getWorkspaceDirtyState(targetWorkspaceId, workspaceDirtyRef)
const isDirty = dirtyState.isDirty
```

The logging now includes detailed dirty state breakdown:
```typescript
metadata: {
  isDirty,
  componentStoreDirty: dirtyState.componentsDirty,
  workspaceLevelDirty: dirtyState.notesPanelsDirty,
  componentsDirtyIds: dirtyState.componentsDirtyIds,
  // ...
}
```

### 3. Existing Persistence Guards Documented

**File:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts` (lines 828-920)

The existing inline guards in `persistWorkspaceById` already implement the Phase 2 policy:

| Guard | Implementation | Location |
|-------|----------------|----------|
| Transient mismatch detection | `openNotes.length === 0 && panels.length > 0` | Line 833 |
| Defer with retry | `MAX_INCONSISTENT_PERSIST_RETRIES` (3 attempts) | Lines 838-871 |
| Repair from authoritative source | Seeds `openNotes` from panel note IDs | Lines 874-920 |

This matches the guard policy defined in `lib/workspace/durability/guards.ts`.

---

## Files Modified

| File | Change |
|------|--------|
| `lib/workspace/durability/dirty-tracking.ts` | **NEW** - Unified dirty tracking functions |
| `lib/workspace/durability/index.ts` | Added exports for dirty tracking |
| `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` | Updated to use unified dirty check |

---

## Guard Policy Summary

### Eviction Guards (now unified)

| Check | Action | Rationale |
|-------|--------|-----------|
| `isWorkspaceDirty()` returns true | Attempt persist before eviction | Don't lose unsaved changes |
| Persist fails + dirty | Block eviction | Hard-safe: no silent data loss |
| Persist fails + clean | Allow eviction | Nothing to lose |

### Persistence Guards (existing, conforming)

| Check | Action | Rationale |
|-------|--------|-----------|
| `isHydrating` or `replaying` | Skip persist | Don't persist during restore |
| `panels > 0 && openNotes === 0` | Defer then repair | Transient mismatch |
| Revision unknown | Would fail with 409 | Handled by existing revision check |

---

## Why Incremental Approach

Rather than refactoring `persistWorkspaceById` to call `checkPersistGuards()` directly, we:

1. **Created the unified infrastructure** - The guard module exists and is ready
2. **Wired critical path** - Eviction now uses unified dirty check
3. **Documented conformance** - Existing persistence guards follow the same policy

This is safer because:
- No risk of breaking existing persistence behavior
- The unified module can be incrementally adopted
- Debug logging now shows per-domain dirty breakdown

---

## Acceptance Criteria

- [x] Unified dirty check function created (`isWorkspaceDirty`)
- [x] Eviction uses unified dirty check (no longer inline)
- [x] Detailed dirty state available for logging (`getWorkspaceDirtyState`)
- [x] Existing persistence guards documented as conforming
- [x] Type-check passes
- [x] No behavior change (incremental adoption)

---

## Integration with Other Phases

### Phase 3 (Unified Restore)

The unified dirty check can be used to verify restore completed correctly:
- After restore, workspace should not be dirty
- If dirty immediately after restore, something went wrong

### Phase 4 (Unified Dirty Model)

This phase created the dirty tracking infrastructure. Phase 4 will:
- Ensure all dirty-setting code paths use a unified API
- Add lifecycle state to block dirty during restore

### Phase 5 (Persistence Scheduling)

The `getAllDirtyWorkspaceIds()` function is ready for use in flush-all scenarios.

---

## Testing Notes

To verify the unified dirty check is working:

1. Open dev tools console
2. Make changes in a workspace (move a panel, edit a timer)
3. Trigger eviction by opening 5+ workspaces
4. Check logs for `workspace_runtime_eviction_start` with detailed dirty state:
   ```
   componentStoreDirty: true/false
   workspaceLevelDirty: true/false
   componentsDirtyIds: [...]
   ```

---

## Next Steps

**Phase 3:** Wire lifecycle state to hydration so hot/cold classification uses `ready` state
instead of "runtime exists".
