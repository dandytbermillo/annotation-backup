# Canonical Persist Wiring - Sequenced Checklist

**Date:** 2025-12-18
**Status:** COMPLETE (All 7 Steps Implemented)  
**Scope:** Wire policy layer (durability/) into execution layer (persistence hooks)  

---

## Goal

Make `persistWorkspaceById` the single execution entrypoint and ensure it always calls the policy layer:

```
ALL triggers → persistWorkspaceById
                 ↓
           checkPersistGuards
                 ↓
         buildUnifiedSnapshot
                 ↓
         adapter.saveWorkspace
```

This turns today’s “works by convention” into “works by construction.”

---

## Sequenced Implementation Order (Lowest Risk First)

### Step 1 - Canonical Guard Wiring (Highest Leverage, Lowest Behavior Change)

**File:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts`  
**Target:** `persistWorkspaceById`  

**Change**

- Call `checkPersistGuards` before building/saving.
- Use the returned decision to:
  - allow → continue
  - retriable block → defer/retry
  - non-retriable block → return `false` (eviction will block)

**Keep**

- Existing inline guards (for parity) during the first pass.
- Existing logging and revision recovery.

**Risk**

- Low. Guard logic already exists; this just centralizes it.

---

### Step 2 - Unified Snapshot Builder

**Files:**  
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts`  
- `lib/workspace/durability/snapshot-builder.ts`  

**Change**

- Replace `buildPayload()` / `buildPayloadFromSnapshot()` usage with:
  - `buildUnifiedSnapshot` → `toNoteWorkspacePayload`
- Ensure component sourcing is store-first (via `getComponentsForPersistence`).

**Keep**

- Hash-based "no changes" skip.
- Existing payload hash tracking and revision updates.

**Risk**

- Medium. Ensure the unified snapshot builder covers all fields used by current payload logic.

---

### Step 3 - Make persistWorkspaceNow a Thin Wrapper

**File:** `lib/hooks/annotation/workspace/use-workspace-persistence.ts`  
**Target:** `persistWorkspaceNow`  

**Change**

- Replace its internal save logic with a call to `persistWorkspaceById` (same reason/metadata).

**Keep**

- Readiness waits (`waitForPanelSnapshotReadiness`) if they are still required for UI stability.

**Risk**

- Low. Eliminates duplicate logic.

---

### Step 4 - Eviction Uses Canonical Path Only

**Files:**  
- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`  
- `lib/hooks/annotation/use-note-workspaces.ts`  
**Target:** eviction flow (`evictWorkspaceRuntime`)  

**Change**

- Ensure eviction always calls `persistWorkspaceById` (or a unified wrapper), not any alternate save path.
- Confirm `persistWorkspaceSnapshot` delegates to the canonical path via `persistWorkspaceByIdRef`.

**Keep**

- Dirty + persist failed → block eviction.
- Unified dirty check (already in place).

**Risk**

- Low to medium. Eviction is sensitive; keep logs intact for verification.

---

### Step 4.5 - Retire Redundant Pre-Eviction Component Flush (After Step 2)

**File:** `lib/workspace/store-runtime-bridge.ts`  
**Target:** `preEvictionPersistCallback` registration  

**Change**

- Disable or remove the pre-eviction component flush **only after** the unified snapshot builder
  is canonical (Step 2 complete).
- This prevents double‑writes and races once components are included via the unified payload.

**Keep**

- Any safety logging around eviction and blocked reasons.
- The callback can remain behind a feature flag if you want a rollback path.

**Risk**

- Low **after** Step 2. Before Step 2, keep the callback as a safety net.

---

### Step 5 - Component Store Persistence Routes Through Canonical Path

**Files:**  
- `lib/workspace/workspace-component-store.ts`  
- `lib/workspace/store-runtime-bridge.ts`  
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts`  

**Change**

- The store’s persist callback should request a workspace persist (reason `components_changed`)
  rather than writing components directly to the DB.
- Route component persist requests through the persist requester registry
  (`requestWorkspacePersist` → `persistWorkspaceById`).
- Ensure the global persist requester is registered from the persistence hook.

**Keep**

- Store-level dirty tracking and scheduler (still useful for batching).
- Lifecycle guard for dirty marking.

**Risk**

- Medium. Ensure no double-save loops are introduced.

---

### Step 6 - Unify Dirty Set/Clear Calls

**Files:**  
- `lib/workspace/durability/dirty-tracking.ts`  
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts`  
**Targets:** callsites in persistence hooks  

**Change**

- Replace direct `workspaceDirtyRef.current.set/delete` with:
  - `setWorkspaceDirtyIfAllowed`
  - `clearWorkspaceDirty`

**Keep**

- Existing timestamps and dirty metadata used for logging.

**Risk**

- Low. This reduces false dirty during restore windows.

---

### Step 7 - Hot/Cold Decisions Use Lifecycle (Final Consistency Pass)

**Files:**
- `lib/hooks/annotation/workspace/use-workspace-selection.ts`
- `lib/hooks/annotation/workspace/use-workspace-hydration.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`
- `lib/workspace/store-runtime-bridge.ts`

**Change**

- Ensure hot/cold uses lifecycle `ready`, not merely runtime existence.
- Replace remaining `isWorkspaceHydrated` checks with lifecycle readiness snapshots (selection/hydration/preview error path).
- Replace remaining `hasWorkspaceRuntime` checks with lifecycle readiness (buildPayload, preview, capture retry).
- Remove runtime-based empty snapshot rejection in preview; lifecycle-only flow decides hot vs cold.

**Keep**

- Existing lifecycle transitions (restore → ready).

**Risk**

- Medium. Should be covered by existing tests and manual runs.

---

## Implementation Status

| Step | Description | Status | Completed |
|------|-------------|--------|-----------|
| 1 | Canonical Guard Wiring | ✅ DONE | 2025-12-18 |
| 2 | Unified Snapshot Builder | ✅ DONE | 2025-12-18 |
| 3 | persistWorkspaceNow Thin Wrapper | ✅ DONE | 2025-12-18 |
| 4 | Eviction Uses Canonical Path | ✅ DONE | 2025-12-18 |
| 4.5 | Retire Pre-Eviction Flush | ✅ DONE | 2025-12-18 |
| 5 | Component Store Routes Through Canonical | ✅ DONE | 2025-12-18 |
| 6 | Unify Dirty Set/Clear | ✅ DONE | 2025-12-18 |
| 7 | Hot/Cold Uses Lifecycle Only | ✅ DONE | 2025-12-19 |

---

## Post-Implementation Verification

- [x] Offline eviction (dirty) blocks with toast + no data loss.
- [x] Cold restore never skips DB replay for placeholder runtimes.
- [x] No persisted-empty payloads during transient mismatch.
- [x] Components and notes/panels always persist together.

**Manual Test Report:** `docs/proposal/workspace-state-machine/test/2025-12-19-step7-lifecycle-only-manual-tests.md`
