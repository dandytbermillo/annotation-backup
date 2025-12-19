# Implementation Plan: Unified Workspace Durability Pipeline (Notes/Panels + Components)

**Date:** 2025-12-18
**Status:** Safety Complete / Architectural Unification In Progress
**Scope:** Option A (single-writer; no CRDT/Yjs)

---

## Current Status (2025-12-18)

### What's Complete: Safety Outcomes ✅

The **behavioral safety objectives** of this plan are achieved:

| Objective | Status | Implementation |
|-----------|--------|----------------|
| No empty overwrites | ✅ | Inline guards in `persistWorkspaceById`/`persistWorkspaceNow` |
| Eviction blocks on dirty+failed persist | ✅ | Hard-safe eviction in `use-note-workspace-runtime-manager.ts` |
| Unified dirty aggregation | ✅ | `isWorkspaceDirty()` in `durability/dirty-tracking.ts` |
| Lifecycle-based restore classification | ✅ | `lifecycle-manager.ts` + hydration integration |
| Dirty guards during restore/re-entry | ✅ | `shouldAllowDirty()` in Phase 4 |
| Defer/retry for transient mismatches | ✅ | Inline guards with bounded retries |
| Degraded mode for repeated failures | ✅ | `consecutiveFailures` tracking in runtime manager |

### What's Incomplete: Architectural Unification ❌

The **"single durability boundary"** architectural goal is NOT yet enforced:

| Goal | Status | Gap |
|------|--------|-----|
| One guard function rules all | ❌ | `checkPersistGuards()` exists but isn't called by persistence code |
| One snapshot builder | ❌ | `buildUnifiedSnapshot()` exists but `buildPayload()` still used |
| All paths through unified boundary | ❌ | Persistence uses inline guards, not the canonical functions |

**Current architecture:**
```
persistWorkspaceById → inline guards → buildPayload() → save
persistWorkspaceNow  → inline guards → buildPayload() → save
                       ↑ duplicated    ↑ older builder

checkPersistGuards()   ← exists but NOT called
buildUnifiedSnapshot() ← exists but NOT called
```

**Target architecture:**
```
ALL persistence paths → checkPersistGuards() → buildUnifiedSnapshot() → save
```

### Remaining Work

To achieve true architectural unification:

1. **Wire `checkPersistGuards`** into `persistWorkspaceById` and `persistWorkspaceNow`
2. **Replace `buildPayload()`** with `buildUnifiedSnapshot()`
3. **Remove inline guards** (they become redundant)
4. **Enforce** that all future persistence code uses the unified boundary

This is consolidation/refactor work, not safety work. The system is safe today.

---

## Problem / Motivation

Workspaces currently contain two durable domains:

- **Notes/Panels domain:** open notes membership, active note, panel snapshots, camera.
- **Components domain:** standalone widgets (timer, calculator, etc.) with their own durable state.

Even when both domains are persisted into the same DB payload, they can still travel through different
timing paths, dirty tracking, and readiness guards. This creates “split-brain durability” failure modes:

- One domain persists while the other is skipped or pruned.
- Cold restore can be skipped or partially applied (“hot” misclassification).
- Empty/partial payloads can overwrite valid DB state during transient UI/runtime mismatch windows.

This plan unifies **save + restore + guards + dirty semantics** at the workspace boundary while keeping
notes/panels and components as separate *data types* (they remain different concepts).

---

## Goals

1. **Single durability boundary:** Every durable workspace save/restore goes through the same pipeline.
2. **Atomic restore intent:** On cold restore, apply notes/panels and components together before the
   workspace is considered “ready for saving.”
3. **Unified guards:** The same correctness guards apply to both domains (hydration, revision known,
   transient mismatch protection, offline/degraded handling).
4. **Unified dirty model:** Workspace dirty is a single concept derived from all durable domains.
5. **Preserve state, not behavior:** On reload, restore durable state (time remaining, values, text)
   but background “operations” remain stopped unless explicitly resumed.

---

## Non-Goals

- Redesigning note branching semantics (Explore/Promote/Note) or merging notes into component state.
- Making components part of the branching tree (they remain standalone tools/widgets).
- Multi-writer/collaborative correctness (CRDT/Yjs) in this phase.

---

## Key Invariant (Target)

**A workspace is either:**

- **`ready`** (fully restored/hydrated and safe to persist/evict), or
- **`restoring`/`hydrating`** (persistence must not run and eviction must not destroy state), or
- **`degraded`** (cold opens blocked until user recovers).

This lifecycle applies to the *whole workspace*, not separately to notes vs components.

---

## Architectural Overview (V1)

### Durable Snapshot (Concept)

A workspace durable snapshot is the union of:

- Notes/Panels: `openNotes`, `activeNoteId`, `panels`, `camera`
- Components: `components[]` (durable component state + placement)

The pipeline has two symmetric operations:

1. **Capture (Save):** “Read durable snapshot from authoritative sources → validate/guard → persist”
2. **Apply (Restore):** “Load DB payload → apply all domains → mark workspace ready”

### Where Unification Happens

Unification should live in a workspace-level module (not inside individual components):

- A single “snapshot builder” that knows how to read both domains.
- A single “restore applier” that knows how to apply both domains.
- A single “guard policy” used by persistence + eviction.

---

## How This Plugs Into Current Code (Touchpoints + Ordering)

This section maps the plan onto the current codebase so the work can be executed incrementally with
minimal risk. The goal is **not** to rewrite everything, but to consolidate “durability decisions” so
notes/panels and components cannot diverge.

### Existing Building Blocks (Current State)

- **Persistence entry point (workspace-level):**
  - `lib/hooks/annotation/workspace/use-workspace-persistence.ts:662` (`persistWorkspaceById`)
  - This already differentiates active vs background persistence and uses snapshot capture for
    background workspaces.

- **Snapshot → payload builder (union already exists conceptually):**
  - `lib/hooks/annotation/workspace/use-workspace-snapshot.ts:1018` (`buildPayloadFromSnapshot`)
  - This builds a payload containing `openNotes`, `panels`, `camera`, and `components` (if present).

- **Component persistence bridge (store-first):**
  - `lib/workspace/store-runtime-bridge.ts:73` (`getComponentsForPersistence`)
  - This is the “authoritative component read” surface during migration (store → runtime fallback).

- **Hydration/restore control point (hot/cold decisions):**
  - `lib/hooks/annotation/workspace/use-workspace-hydration.ts:710` (`hydrate_skipped_hot_runtime`)
  - `lib/hooks/annotation/workspace/use-workspace-hydration.ts:734` (`hydrate_on_route_load`)
  - This is where “runtime exists” has historically caused restore misclassification.

- **Prune (risk area during cold open/transient mismatch):**
  - `lib/hooks/annotation/use-note-workspaces.ts:506` (`pruneWorkspaceEntries`)
  - This must not run in a way that can remove valid membership when observed IDs are temporarily 0.

- **Eviction/persistence coupling (capacity / safety):**
  - `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:345` (`evictWorkspaceRuntime(..., "capacity")`)
  - This is where “persist then remove runtime” must be aligned with the unified guard policy.

- **Workspace-level dirty tracking (notes/panels):**
  - `lib/hooks/annotation/use-note-workspaces.ts` passes `workspaceDirtyRef` into runtime manager/persistence
    (multiple references, e.g. `lib/hooks/annotation/use-note-workspaces.ts:768`).

### The Integration Strategy (Minimal, Incremental)

1. **Make one snapshot builder the source of truth**
   - Treat `buildPayloadFromSnapshot` as the “workspace durable payload compiler” (notes/panels +
     components together).
   - Ensure its component sourcing is unified with the component store bridge (store-first, ledger
     fallback) so it can’t drift from what components are actually persisting.

2. **Route all persistence reasons through the same guard policy**
   - Whether the trigger is `components_changed`, `panels_changed`, entry-switch flushing, or capacity
     eviction, the same guard rules must apply:
     - don’t persist during `restoring/hydrating`
     - don’t persist “transient mismatch empties”
     - don’t attempt a revision-constrained write when revision is unknown for an unhydrated workspace

3. **Route all restore decisions through workspace lifecycle (not runtime existence)**
   - Hot/cold classification should be based on “already restored” (workspace lifecycle `ready`),
     not “a runtime object exists.”
   - Placeholder/empty runtimes must always hydrate/cold-restore.

4. **Make dirty a single workspace-level concept**
   - Eviction and persistence scheduling should consult one “workspace dirty” decision that aggregates:
     - workspace-level dirty (panels/openNotes/camera)
     - component store dirty (durable component state changes)

### Ordering (What Must Happen Before What)

**Cold restore path (must be atomic in intent):**

1. Workspace is selected.
2. Workspace enters lifecycle `restoring/hydrating` (this blocks persistence).
3. DB payload is loaded.
4. Apply notes/panels membership and panel snapshots.
5. Apply component snapshots into the component store (and any runtime registration needed for render).
6. Mark workspace lifecycle `ready`.
7. Only after `ready` may any persistence scheduling run.

**Capacity eviction path (hard-safe):**

1. Candidate workspace is selected for eviction.
2. If workspace is dirty → attempt persist via the unified pipeline.
3. If persist fails and workspace was dirty → block eviction + notify user (no silent data loss).
4. If persist succeeds (or workspace clean) → remove runtime.

### What This Changes (Practically)

- It does **not** merge “notes” and “components” into one data type.
- It *does* ensure both travel together through the same save/restore timing rules, so you cannot
  accidentally save “components OK but openNotes empty” (or vice-versa) during transient windows.

---

## Phase Plan

### Phase 0 — Audit Dirty Sources (Pre-work)

Before unifying dirty into a single `isWorkspaceDirty(workspaceId)` decision, document (and verify)
every current place that can create “dirty” durable state. This prevents accidental gaps where one
domain is not represented in the unified dirty decision.

**Deliverables**

- A short inventory of dirty sources for:
  - Notes/Panels: `openNotes`, `activeNoteId`, `panels`, `camera`
  - Components: component store dirty tracking (and any remaining legacy paths)
  - Schedulers: any “flush/immediate save” paths that may bypass “mark dirty”
- For each source: how it is cleared (successful persist, explicit reset, etc.).

**Acceptance**

- There is a documented list of dirty sources and clearing conditions.
- Unified dirty aggregation can be implemented without guessing.

### Phase 1 — Define the Workspace Durability Boundary

**Deliverables**

- A single “workspace durable snapshot” contract (types + required/optional fields).
- A single entry point used by persistence for building payloads:
  - Active workspace: read from current authoritative sources
  - Background workspace: read from cached snapshots / runtime ledger / store

**Implementation Notes**

- Notes/Panels and Components remain separate sub-objects in the snapshot.
- Avoid reading from sources that are known to be transient during cold open (e.g., “observed notes”
  that can be empty before the canvas renders).

**Acceptance**

- Every persistence call uses the same snapshot builder for both notes/panels and components.
- The snapshot builder never emits a payload that is “obviously inconsistent” (see Phase 2 guards).

---

### Phase 2 — Unified Guards (Prevent Empty/Partial Overwrites)

**Problem**

The most dangerous failure mode is persisting “empty” state during a transient mismatch:

- runtime says there are open notes, but observed/canvas says 0
- panels exist but openNotes is empty
- components are available in store/ledger but not yet registered for rendering

**Guard Policy (Workspace-level)**

- If `panels.length > 0` and `openNotes.length === 0`: treat as transient mismatch → defer/retry or
  repair (depending on configured policy).
- If “observed” note IDs are 0 but runtime says open notes > 0: do not prune notes during capture.
- If revision is unknown for a workspace that is not yet hydrated: do not attempt a durability write
  that can fail with revision/precondition mismatch; treat as “not ready to persist.”

**Acceptance**

- No durable write is allowed to reduce `openNotes/panels/components` to empty due to timing windows.
- The system prefers “delay/skip” over “persist empties.”

---

### Phase 3 — Unified Restore (Cold Restore is Never Misclassified)

**Problem**

Hot/cold restore decisions can be misclassified when a runtime/store object exists but has not been
restored from DB yet (placeholder runtime).

**Restoration Policy**

- “Hot” should mean **already restored** (workspace lifecycle is `ready`), not merely “runtime exists.”
- On cold restore:
  - Apply notes/panels membership and panel snapshots
  - Apply component state to the component store (and any necessary runtime registrations)
  - Only then mark workspace lifecycle `ready`

**Acceptance**

- Cold restore always replays the DB snapshot when workspace is not `ready`.
- No “skip restore because runtime exists” when the runtime/store is a placeholder/empty.

---

### Phase 4 — Unified Dirty Model (One Workspace Dirty Flag)

**Problem**

Split dirty tracking causes incorrect eviction/persist decisions:

- panels/openNotes dirty vs components dirty tracked separately
- some changes schedule flush without marking dirty (historically)

**Dirty Policy**

Workspace “dirty” should be true if any of the following are true:

- panels/openNotes/camera have changed since last persisted snapshot
- component store has dirty changes since last persisted snapshot

Expose one function for safety checks:

- `isWorkspaceDirty(workspaceId)` → used by:
  - hard-safe eviction gating
  - persistence scheduler
  - degraded-mode heuristics

**Acceptance**

- Eviction/persist decisions cannot miss “dirty” changes from either domain.

---

### Phase 5 — Persistence Scheduling Uses the Unified Boundary

**Scheduling Rules**

- No persistence attempts while workspace lifecycle is `restoring/hydrating`.
- Background persistence must use the same snapshot builder and guard policy.
- If a persist is blocked due to guards, it should:
  - defer/retry (bounded)
  - and/or enter degraded mode if repeated failures + risk of data loss

**Acceptance**

- All persistence reasons (components_changed, panels_changed, capacity eviction, entry switch flush)
  are funneled through the same guarded boundary.

---

### Phase 6 — Manual + Automated Validation

**Manual Scenarios (Must Pass)**

1. **Cold restore (no running components)**
   - Workspace contains notes + panels + components, none “running”
   - After reload, all durable state returns; operations are stopped (expected)

2. **Capacity eviction while offline (dirty)**
   - Make any workspace dirty without starting an active operation
   - Go offline; attempt cold opens until eviction blocks
   - Verify eviction blocks and does not destroy dirty workspace state

3. **Entry switching**
   - Navigate away and back; ensure “revision unknown” does not cause false persist failures
   - No empty overwrites and no toast spam when online

4. **Transient mismatch protection**
   - Trigger cold open where observed note IDs are 0 temporarily
   - Ensure no pruning/persist empties occur; state remains intact

**Automated Coverage (Recommended)**

- Snapshot builder invariants (no inconsistent output)
- Guard policy behavior (defer vs repair decision)
- Restore lifecycle correctness (ready vs restoring)

---

## Relationship to Existing Work

This plan is intended to consolidate and formalize what has been learned/fixed in:

- Hard-safe eviction + degraded mode gating
- Revision recovery on entry switch
- Persisted-empty openNotes guard
- Prune transient mismatch protection
- Component store + store/runtime bridge

References:

- `docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md`
- `docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-16-persisted-empty-open-notes-guard.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-17-revision-recovery-on-entry-switch.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-18-prune-transient-mismatch-fix.md`
- `docs/proposal/workspace-state-machine/offline-durable-queue/IMPLEMENTATION_PLAN.md`

---

## Open Decisions

1. **Dedupe semantics for notifications/logging** (if unified pipeline emits events):
   - Default: keep deduped notifications “read” if the user already read them, to avoid spam.
   - Exception: if severity increases (e.g., `warning → error`), re-mark as “unread” to re-surface.
2. **Guard strategy: defer vs repair**
   - For mismatches like `panels>0 && openNotes=0`, do we always defer N times then repair, or
     do we treat “repair” as a last resort only?

Suggested default policy:

- **Defer (bounded) with backoff:** 3 retries with exponential backoff (e.g., 100ms → 200ms → 400ms).
- **Then repair (last resort):** If mismatch persists, repair membership from **durable/authoritative
  evidence** (e.g., panel note IDs and/or runtime open notes), not from “observed/canvas” signals.
- **Repair source priority (be explicit):**
  1. **Panels note IDs** (persisted; strongest durable evidence)
  2. **Runtime open notes list** (if runtime exists and is populated)
  3. **Never** use canvas/observed signals during the mismatch window
- **Visibility:** Emit a warning-level notification when a repair was applied so the system is
  inspectable (it’s safer than silently mutating state).
