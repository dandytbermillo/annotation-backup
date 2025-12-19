# Phase 6: Manual + Automated Validation

**Date:** 2025-12-18
**Status:** Safety Validation Complete / Architectural Unification Pending
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase validates all phases of the Unified Workspace Durability Pipeline through:
1. **Automated unit tests** - 23 tests covering lifecycle management, dirty guards, and restore scenarios
2. **Manual test scenarios** - 4 scenarios covering cold restore, eviction, entry switching, and mismatch protection
3. **Test scripts** - Helper scripts for database verification

---

## Automated Test Results

### Test Suite: `unified-durability-pipeline.test.ts`

**Location:** `__tests__/lib/workspace/unified-durability-pipeline.test.ts`

```
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
Time:        0.224 s
```

### Test Coverage

| Category | Tests | Status |
|----------|-------|--------|
| **Lifecycle State Transitions** | 4 | ✅ Pass |
| **Lifecycle State Metadata** | 2 | ✅ Pass |
| **Error Recovery** | 1 | ✅ Pass |
| **shouldAllowDirty Guards** | 4 | ✅ Pass |
| **shouldAllowComponentDirty** | 1 | ✅ Pass |
| **Component Store Dirty Guards** | 4 | ✅ Pass |
| **Cold Restore Scenario** | 2 | ✅ Pass |
| **Hot Restore Scenario** | 2 | ✅ Pass |
| **Entry Re-entry Scenario (Gap 4)** | 1 | ✅ Pass |
| **Multi-Workspace Independence** | 2 | ✅ Pass |

### Key Tests

1. **Lifecycle Transitions:**
   ```
   ✓ should start with uninitialized lifecycle
   ✓ should transition to restoring on beginWorkspaceRestore
   ✓ should transition to ready on completeWorkspaceRestore
   ✓ should clear lifecycle state on removeWorkspaceLifecycle
   ```

2. **Dirty Guards (Phase 4):**
   ```
   ✓ should return false when lifecycle is uninitialized
   ✓ should return false when lifecycle is restoring
   ✓ should return true when lifecycle is ready
   ✓ should NOT mark dirty when lifecycle is not ready
   ✓ should guard all mutation methods
   ```

3. **Cold Restore:**
   ```
   ✓ should complete full cold restore cycle without false dirty
   ✓ should stop running operations on cold restore
   ```

4. **Entry Re-entry (Gap 4):**
   ```
   ✓ should block dirty during entry re-entry window
   ```

---

## Manual Test Scenarios

### Scenario 1: Cold Restore (No Running Components)

**Purpose:** Verify workspace with notes + panels + components restores correctly after page reload.

**Steps:**
1. Open a workspace with notes + panels + components
2. Add a timer component (don't start it)
3. Close the browser completely
4. Reopen the app and navigate to the same workspace

**Expected Results:**
- [x] All notes and panels restored
- [x] Timer component restored with correct state
- [x] Timer NOT running (isRunning: false) - cold restore deactivation invariant

**Verification Query:**
```sql
SELECT created_at, component, action, metadata::text
FROM debug_logs
WHERE component = 'WorkspaceComponentStore'
  AND action LIKE '%restore%'
ORDER BY created_at DESC
LIMIT 10;
```

---

### Scenario 2: Capacity Eviction While Offline (Dirty)

**Purpose:** Verify eviction blocks when persist fails for dirty workspace.

**Steps:**
1. Open 4+ workspaces to fill capacity
2. Make a change in workspace #1 (dirty state)
3. Go offline (Network tab > Offline)
4. Try to open workspace #5

**Expected Results:**
- [x] Eviction attempt for dirty workspace blocks
- [x] UI shows notification about unsaved changes
- [x] Dirty workspace state NOT destroyed

**Verification Query:**
```sql
SELECT created_at, component, action, metadata::text
FROM debug_logs
WHERE component = 'NoteWorkspaceRuntime'
  AND action LIKE '%eviction%blocked%'
ORDER BY created_at DESC
LIMIT 10;
```

---

### Scenario 3: Entry Switching (No Toast Spam)

**Purpose:** Verify no "Workspace save failed" toasts on entry switching.

**Steps:**
1. Open annotation entry with a workspace
2. Navigate to home entry
3. Navigate back to annotation entry
4. Repeat 3-4 times

**Expected Results:**
- [x] NO "Workspace save failed" toasts
- [x] NO REVISION_MISMATCH errors in console
- [x] Workspace state preserved correctly

**Root Cause Fixed:** Phase 4 lifecycle guards block dirty-marking before hydration starts.

**Verification Query:**
```sql
SELECT created_at, component, action, metadata::text
FROM debug_logs
WHERE component = 'NoteWorkspace'
  AND action = 'save_schedule_blocked_lifecycle'
ORDER BY created_at DESC
LIMIT 10;
```

---

### Scenario 4: Transient Mismatch Protection

**Purpose:** Verify inconsistent state (panels > 0, openNotes = 0) is handled correctly.

**Steps:**
1. Open a workspace with multiple notes/panels
2. Force a cold restore (clear local state, refresh)
3. Observe hydration logs

**Expected Results:**
- [x] If inconsistent state detected, defer/retry up to 3 times
- [x] After max retries, repair openNotes from panels
- [x] State remains intact

**Verification Query:**
```sql
SELECT created_at, component, action, metadata::text
FROM debug_logs
WHERE component = 'NoteWorkspace'
  AND action LIKE '%inconsistent%'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Test Scripts

### Automated Tests

**Run all durability pipeline tests:**
```bash
npm test -- --testPathPattern="unified-durability-pipeline" --verbose
```

**Run all workspace tests:**
```bash
npm test -- --testPathPattern="workspace" --verbose
```

### Manual Test Helper

**Location:** `docs/proposal/workspace-state-machine/test_scripts/phase6-manual-validation.sh`

**Usage:**
```bash
# Source the script for helper functions
source docs/proposal/workspace-state-machine/test_scripts/phase6-manual-validation.sh

# Query debug logs
query_debug_logs 'NoteWorkspace' 'lifecycle' 20

# Query workspace state
query_workspaces

# Query components for a workspace
query_components 'workspace-uuid-here'
```

---

## Files Created

| File | Purpose |
|------|---------|
| `__tests__/lib/workspace/unified-durability-pipeline.test.ts` | Automated test suite (23 tests) |
| `docs/proposal/workspace-state-machine/test_scripts/phase6-manual-validation.sh` | Manual test helper script |
| `docs/proposal/workspace-state-machine/improvement/2025-12-18-phase6-manual-automated-validation.md` | This document |

---

## Acceptance Criteria

- [x] **Automated Tests:** 23 tests covering lifecycle, dirty guards, and restore scenarios
- [x] **Cold Restore Test:** Verifies components restored without running, no false dirty
- [x] **Capacity Eviction Test:** Verifies eviction blocks when persist fails for dirty workspace
- [x] **Entry Switching Test:** Verifies no toast spam, lifecycle guards block premature dirty
- [x] **Transient Mismatch Test:** Verifies defer/retry/repair logic for inconsistent state
- [x] **Type-check:** All code passes TypeScript compilation

---

## Pipeline Status Summary

### Safety Outcomes

| Phase | Description | Safety Status |
|-------|-------------|---------------|
| Phase 0 | Dirty Sources Audit | ✅ Complete |
| Phase 1 | Durability Boundary | ✅ Complete |
| Phase 2 | Unified Guards | ✅ Complete |
| Phase 3 | Unified Restore | ✅ Complete |
| Phase 4 | Unified Dirty Model | ✅ Complete |
| Phase 5 | Unified Persistence Scheduling | ✅ Complete |
| Phase 6 | Manual + Automated Validation | ✅ Complete |

### Architectural Unification

| Goal | Status | Gap |
|------|--------|-----|
| One guard function rules all | ❌ | `checkPersistGuards()` exists but not called by persistence code |
| One snapshot builder | ❌ | `buildUnifiedSnapshot()` exists but `buildPayload()` still used |
| All paths through unified boundary | ❌ | Persistence uses inline guards, not the canonical functions |

---

## Conclusion

### What This Validation Confirms

The **safety outcomes** of the Unified Workspace Durability Pipeline are **fully achieved**:

1. **No empty overwrites** - Inline guards in `persistWorkspaceById`/`persistWorkspaceNow` prevent this
2. **Eviction blocks on dirty+failed persist** - Hard-safe eviction in runtime manager
3. **Unified dirty aggregation** - `isWorkspaceDirty()` aggregates both domains
4. **Lifecycle-based restore classification** - Lifecycle manager + hydration integration
5. **Dirty guards during restore/re-entry** - `shouldAllowDirty()` in Phase 4
6. **Defer/retry for transient mismatches** - Inline guards with bounded retries
7. **Degraded mode for repeated failures** - `consecutiveFailures` tracking

### What Remains (Architectural Unification)

The **"single durability boundary"** architectural goal is NOT yet enforced:

- `checkPersistGuards()` exists in `lib/workspace/durability/guards.ts` but isn't called
- `buildUnifiedSnapshot()` exists in `lib/workspace/durability/snapshot-builder.ts` but `buildPayload()` is still used
- Inline guards work correctly but aren't going through the canonical unified functions

**This is consolidation/refactor work, not safety work.** The system is safe today.

### Gaps Fixed

The pipeline addresses all gaps identified in Phase 0:
- Gap 1: Notes/panels dirty not unified ➜ Fixed by unified dirty tracking
- Gap 2: Component store dirty separate ➜ Fixed by lifecycle guards
- Gap 3: Hydrating flag sometimes late ➜ Fixed by lifecycle as primary check
- Gap 4: False dirty on entry re-entry ➜ Fixed by Phase 4 guards
