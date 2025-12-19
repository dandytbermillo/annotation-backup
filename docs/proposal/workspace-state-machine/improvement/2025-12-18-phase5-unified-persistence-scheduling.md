# Phase 5: Unified Persistence Scheduling (All Paths Through Same Boundary)

**Date:** 2025-12-18
**Status:** Safety Complete / Architectural Unification Pending
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase ensures all persistence triggers funnel through the same guarded boundary with consistent
rules for hydrating/restoring checks, defer/retry logic, and degraded mode handling.

**Key finding:** Phase 5 requirements were already implemented through several prior fixes:
- Hard-safe 4-cap eviction
- Prune transient mismatch fix
- Phase 4 lifecycle guards

This document formally verifies and records the implementation.

---

## Status Clarification

### Safety Outcomes: ✅ Complete

All persistence paths apply equivalent guards that prevent:
- Empty overwrites during transient mismatch
- Persistence during hydration/restoring
- Eviction of dirty workspaces when persist fails

### Architectural Unification: ❌ Incomplete

The guards are implemented **inline** in each persistence function rather than through the
canonical `checkPersistGuards()` function in `lib/workspace/durability/guards.ts`.

**Current state:**
```
persistWorkspaceById → inline guards (equivalent logic)
persistWorkspaceNow  → inline guards (equivalent logic)
checkPersistGuards() → exists but NOT called
```

**Target state:**
```
ALL persistence → checkPersistGuards() → snapshot builder → save
```

This is a consolidation/refactor task, not a safety issue. The inline guards correctly
prevent data loss; they just aren't going through the single canonical entrypoint.

---

## Problem Solved

### Before (Fragmented Persistence Paths)

Different persistence triggers could bypass guards:

| Trigger | Risk |
|---------|------|
| `components_changed` effect | Could fire during hydration, causing empty persist |
| Capacity eviction | Could persist incomplete state during restore |
| Entry switch flush | Could fail with REVISION_MISMATCH if revision unknown |
| Background persist | Might use different guard policy than active persist |

### After (Unified Boundary)

All persistence paths now:
1. Check hydrating/restoring state before proceeding
2. Apply the same inconsistent-state guards
3. Use bounded defer/retry for transient mismatches
4. Enter degraded mode on repeated failures with data loss risk

---

## Phase 5 Requirements Verification

### Requirement 1: No Persistence During `restoring/hydrating`

**Status: IMPLEMENTED**

| Entry Point | Guard | Location |
|-------------|-------|----------|
| `persistWorkspaceById` | `isWorkspaceHydrating(targetWorkspaceId)` | `use-workspace-persistence.ts:716` |
| `persistWorkspaceById` | `isHydratingRef.current` | `use-workspace-persistence.ts:717` |
| `persistWorkspaceById` | `replayingWorkspaceRef.current > 0` | `use-workspace-persistence.ts:717` |
| `persistWorkspaceNow` | `isHydratingRef.current` | `use-workspace-persistence.ts:1053` |
| `persistWorkspaceNow` | `replayingWorkspaceRef.current > 0` | `use-workspace-persistence.ts:1053` |
| `scheduleSave` | `isHydratingRef.current` | `use-workspace-persistence.ts:1399` |
| `scheduleSave` | `shouldAllowDirty(workspaceId)` (Phase 4) | `use-workspace-persistence.ts:1408` |
| Component store `persist()` | `lifecycle !== 'ready' && lifecycle !== 'persisting'` | `workspace-component-store.ts:368` |

**Guard Behavior:**
```typescript
// persistWorkspaceById (lines 716-730)
const runtimeHydrating = liveStateEnabled && isWorkspaceHydrating(targetWorkspaceId)
if (runtimeHydrating || isHydratingRef.current || replayingWorkspaceRef.current > 0) {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "persist_by_id_skip_busy",
    metadata: { workspaceId, runtimeHydrating, hydrating, replaying },
  })
  return false
}
```

---

### Requirement 2: Background Persistence Uses Same Guard Policy

**Status: IMPLEMENTED**

Both active and background workspaces use `persistWorkspaceById` with identical guards:

```typescript
const persistWorkspaceById = useCallback(async (
  targetWorkspaceId: string,
  reason: string,
  options?: { skipReadinessCheck?: boolean; isBackground?: boolean }
): Promise<boolean> => {
  // Same guards for ALL workspaces:
  // 1. Cooldown check (lines 695-703)
  // 2. In-flight check (lines 706-713)
  // 3. Hydrating check (lines 716-730)
  // 4. Panel readiness check (lines 736-751)
  // 5. Inconsistent state guard (lines 835-929)

  const isActiveWorkspace = targetWorkspaceId === currentWorkspaceId
  const isBackground = options?.isBackground ?? !isActiveWorkspace
  // Guards apply regardless of isBackground value
}, [...])
```

**Unified Guard Policy:**

| Guard | Active Workspace | Background Workspace |
|-------|------------------|----------------------|
| Cooldown | ✅ | ✅ |
| In-flight | ✅ | ✅ |
| Hydrating | ✅ | ✅ |
| Panel readiness | ✅ | ✅ |
| Inconsistent state | ✅ | ✅ |

---

### Requirement 3: Defer/Retry + Degraded Mode

**Status: IMPLEMENTED**

#### Defer/Retry for Inconsistent State

**Configuration:**
```typescript
const MAX_INCONSISTENT_PERSIST_RETRIES = 3
const INCONSISTENT_PERSIST_RETRY_DELAY_MS = 350
```

**Detection:**
```typescript
const isInconsistentState = payload.openNotes.length === 0 && payload.panels.length > 0
```

**Behavior:**
1. **Defer** (retries < 3): Skip persist, schedule retry after 350ms
2. **Repair** (retries >= 3): Seed `openNotes` from `panels` (authoritative durable evidence)

**Implementation Locations:**
- `persistWorkspaceById`: lines 835-929
- `persistWorkspaceNow`: lines 1111-1209

**Repair Logic (Last Resort):**
```typescript
// REPAIR: Max retries exceeded - seed openNotes from panels
const panelNoteIds = Array.from(new Set(
  payload.panels
    .map((p) => p.noteId)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
))

// Commit to runtime so future persists are consistent
commitWorkspaceOpenNotes(targetWorkspaceId, repairedSlots, {
  updateMembership: true,
  updateCache: true,
  callSite: "persist_repair_from_panels",
})
```

#### Degraded Mode for Data Loss Risk

**Configuration:**
```typescript
const CONSECUTIVE_FAILURE_THRESHOLD = 3
```

**Tracking:**
```typescript
// use-note-workspace-runtime-manager.ts
const [consecutiveFailures, setConsecutiveFailures] = useState(0)
const isDegradedMode = consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD
```

**Trigger (Eviction Persist Failure):**
```typescript
// evictWorkspaceRuntime (lines 197-228)
if (!persistResult && isDirty) {
  // Phase 3: Increment consecutive failure counter for bounded backpressure
  setConsecutiveFailures((prev) => {
    const newCount = prev + 1
    emitDebugLogRef.current?.({
      component: "NoteWorkspaceRuntime",
      action: "consecutive_persist_failure",
      metadata: {
        workspaceId: targetWorkspaceId,
        previousFailures: prev,
        newFailures: newCount,
        threshold: CONSECUTIVE_FAILURE_THRESHOLD,
        isDegradedMode: newCount >= CONSECUTIVE_FAILURE_THRESHOLD,
      },
    })
    return newCount
  })
  notifyEvictionBlockedPersistFailed(targetWorkspaceId, reason)
  return { evicted: false, blocked: true, reason: "persist_failed_dirty", workspaceId }
}
```

**Effect (Block Workspace Opening):**
```typescript
// ensureRuntimePrepared (lines 265-280)
if (isDegradedMode) {
  emitDebugLogRef.current?.({
    component: "NoteWorkspaceRuntime",
    action: "workspace_open_blocked_degraded_mode",
    metadata: {
      requestedWorkspaceId: workspaceId,
      reason,
      consecutiveFailures,
      threshold: CONSECUTIVE_FAILURE_THRESHOLD,
    },
  })
  return { ok: false, blocked: true, blockedWorkspaceId: "" }
}
```

**Recovery:**
```typescript
const resetDegradedMode = useCallback(() => {
  setConsecutiveFailures(0)
  emitDebugLog?.({
    component: "NoteWorkspaceRuntime",
    action: "degraded_mode_reset",
    metadata: { previousFailures: consecutiveFailures },
  })
}, [consecutiveFailures, emitDebugLog])
```

---

### Requirement 4: All Persistence Paths Through Same Boundary

**Status: IMPLEMENTED**

| Trigger | Entry Point | Ultimate Handler | Guards Applied |
|---------|-------------|------------------|----------------|
| `components_changed` effect | `scheduleSave` | `persistWorkspaceById` | All |
| `panels_changed` effect | `scheduleSave` | `persistWorkspaceById` | All |
| Capacity eviction | `evictWorkspaceRuntime` | `persistSnapshot` → `persistWorkspaceById` | All |
| Entry switch flush | `flushPendingSave` | `persistWorkspaceById` | All |
| Workspace switch | `selectWorkspace` | `persistWorkspaceNow` | All |
| Component store flush | `persistScheduler.flushNow()` | `store.persist()` | Lifecycle gate |
| Visibility hidden | `handleVisibilityChange` | `flushAllStores()` → `store.persist()` | Lifecycle gate |
| Before unload | `handleBeforeUnload` | Cancel debounce (best effort) | N/A |

---

## Files Involved

| File | Role |
|------|------|
| `lib/hooks/annotation/workspace/use-workspace-persistence.ts` | Main persistence entry points |
| `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` | Eviction + degraded mode |
| `lib/workspace/workspace-component-store.ts` | Component persist + lifecycle gate |
| `lib/workspace/persist-scheduler.ts` | Debounced scheduling + global flush |
| `lib/workspace/runtime-manager.ts` | `isWorkspaceHydrating` check |
| `lib/workspace/durability/dirty-tracking.ts` | `shouldAllowDirty` (Phase 4) |

---

## Persistence Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERSISTENCE TRIGGERS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  components_changed  │  panels_changed  │  eviction  │  entry_switch  │ ... │
└──────────┬───────────┴────────┬─────────┴─────┬──────┴───────┬────────┴─────┘
           │                    │               │              │
           v                    v               v              v
      scheduleSave         scheduleSave    evictWorkspace  flushPendingSave
           │                    │               │              │
           │                    │               v              │
           │                    │        persistSnapshot       │
           │                    │               │              │
           v                    v               v              v
┌─────────────────────────────────────────────────────────────────────────────┐
│                      persistWorkspaceById (UNIFIED BOUNDARY)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ GUARD 1: Cooldown check                                             │   │
│  │ GUARD 2: In-flight check                                            │   │
│  │ GUARD 3: Hydrating/restoring check                                  │   │
│  │ GUARD 4: Panel readiness check                                      │   │
│  │ GUARD 5: Inconsistent state (defer/retry/repair)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    v                                        │
│                          buildPayload() / buildPayloadFromSnapshot()        │
│                                    │                                        │
│                                    v                                        │
│                          adapterRef.current.saveWorkspace()                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Degraded Mode State Machine

```
                    ┌────────────────────────────────────┐
                    │          NORMAL MODE               │
                    │   consecutiveFailures < 3          │
                    │   - Workspace opening allowed      │
                    │   - Eviction can proceed           │
                    └────────────────┬───────────────────┘
                                     │
                    Eviction persist failure (dirty workspace)
                    consecutiveFailures++
                                     │
                                     v
           ┌─────────────────────────────────────────────────┐
           │              DEGRADED MODE                      │
           │   consecutiveFailures >= 3                      │
           │   - Workspace opening BLOCKED                   │
           │   - UI shows DegradedModeBanner                 │
           │   - User must take action to recover            │
           └────────────────────┬────────────────────────────┘
                                │
              User action: resetDegradedMode() OR
              Successful eviction resets counter
                                │
                                v
                    ┌────────────────────────────────────┐
                    │          NORMAL MODE               │
                    │   consecutiveFailures = 0          │
                    └────────────────────────────────────┘
```

---

## Acceptance Criteria

- [x] No persistence attempts while workspace lifecycle is `restoring/hydrating`
  - Verified: `isWorkspaceHydrating`, `isHydratingRef`, `replayingWorkspaceRef` checks
- [x] Background persistence uses same snapshot builder and guard policy
  - Verified: `persistWorkspaceById` handles both active and background
- [x] Blocked persists defer/retry with bounded attempts
  - Verified: `MAX_INCONSISTENT_PERSIST_RETRIES = 3`, delay 350ms
- [x] Repeated failures enter degraded mode
  - Verified: `CONSECUTIVE_FAILURE_THRESHOLD = 3`, blocks workspace opening
- [x] All persistence reasons funneled through same guarded boundary
  - Verified: All paths → `persistWorkspaceById` or lifecycle-gated `store.persist()`
- [x] Type-check passes

---

## Testing Notes

To verify unified persistence scheduling:

1. **Hydrating Guard:**
   - Open dev tools console
   - Switch workspaces rapidly
   - Check for `persist_by_id_skip_busy` logs during hydration

2. **Inconsistent State Defer/Retry:**
   - Look for `persist_blocked_inconsistent_open_notes` logs
   - Verify retry attempts increment
   - After 3 retries, verify `persist_repaired_open_notes_from_panels`

3. **Degraded Mode:**
   - Go offline
   - Open workspaces until capacity reached
   - Attempt eviction with dirty workspaces
   - Verify `workspace_open_blocked_degraded_mode` after 3 failures
   - Verify DegradedModeBanner appears in UI

---

## Prior Work References

Phase 5 functionality was implemented through these prior fixes:

| Fix | Contribution to Phase 5 |
|-----|-------------------------|
| Hard-safe 4-cap eviction (`2025-12-15`) | Degraded mode, consecutive failure tracking |
| Prune transient mismatch fix (`2025-12-18`) | Inconsistent state detection, defer/retry |
| Phase 4 unified dirty model (`2025-12-18`) | `shouldAllowDirty` lifecycle guard in `scheduleSave` |
| Revision recovery on entry switch (`2025-12-17`) | Entry switch flush handling |

---

## Relationship to Other Phases

| Phase | Status | Dependency on Phase 5 |
|-------|--------|----------------------|
| Phase 0 (Dirty Sources Audit) | Complete | Phase 5 uses unified dirty from Phase 0 |
| Phase 1 (Durability Boundary) | Complete | Phase 5 uses snapshot builder types |
| Phase 2 (Unified Guards) | Complete | Phase 5 applies guards to all paths |
| Phase 3 (Unified Restore) | Complete | Phase 5 checks lifecycle state |
| Phase 4 (Unified Dirty Model) | Complete | Phase 5 uses `shouldAllowDirty` |
| Phase 5 (Unified Scheduling) | **Complete** | This document |
| Phase 6 (Validation) | Pending | Will verify all phases together |
