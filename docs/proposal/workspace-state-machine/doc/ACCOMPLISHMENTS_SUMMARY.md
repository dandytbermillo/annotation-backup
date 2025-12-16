# Workspace State Machine — Accomplishments Summary

This document summarizes what has been implemented and validated so far for the workspace state machine and related hard-safety work (workspace persistence, eviction safety, and component store migration).

## Reference Docs (Plans / Addenda / Fixes)

**Primary plan**
- `docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md`

**Addenda**
- `docs/proposal/workspace-state-machine/RUNNING_OPERATIONS_CONTRACT_ADDENDUM.md`
- `docs/proposal/workspace-state-machine/SAFETY_FUTURE_PROOFING_ADDENDUM_DRAFT.md`

**Improvements**
- `docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md`

**Fix writeups**
- `docs/proposal/workspace-state-machine/fixed/2024-12-14-workspace-component-store-bugs-fix.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-15-component-deletion-persistence-fix.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-16-persisted-empty-open-notes-guard.md`

**Reports**
- `docs/proposal/workspace-state-machine/reports/2025-12-14-phase5-component-migration-report.md`

## What We Set Out To Solve

1. **No silent state loss** when workspaces are evicted or switched (especially under the 4-runtime cap).
2. **Workspace-owned durable state** for components (Timer/Calculator/StickyNote as initial migrations), removing reliance on component-local React state for durability.
3. **Restore correctness**: switching/reload should restore the last durable state; “hot vs cold” must not cause skipped restores that drop state.
4. **Developer- and third-party-component compatibility**: the system must remain safe even with unknown component types.

## Key Outcomes (High Level)

### 1) Workspace Component Store (Durable State Owner)

**Result**
- Component durable state is stored per-workspace, and restore flows can re-populate runtime/UI from this store after runtime eviction.

**Why it matters**
- Prevents “default workspace resets” where components re-mount with defaults and immediately overwrite DB before hydration/restore completes.

**Status**
- Implemented and in use for migrated components (see report).

### 2) Hard-Safe Eviction for the 4-Cap Path

**Result**
- The 4-cap eviction path is upgraded from “best-effort” to “hard-safe” behavior:
  - Eviction is gated on durability (persist success) for dirty workspaces.
  - When persist cannot succeed, eviction can be blocked and surfaced to the UI (toast / callbacks).
  - Candidate selection respects protections (pinned/shared/active operations).

**Why it matters**
- Prevents “persist failed → runtime destroyed anyway → silent data loss”.

**Status**
- Implemented (see improvement doc).

### 3) Component Deletion Durability (No “Deleted Components Reappear”)

**Result**
- Deleting components becomes durable: deleted components do not return on reload due to missed persistence scheduling.

**Why it matters**
- Without this, the workspace store could remain correct in memory but fail to persist the deletion event, causing reappearance on cold restore.

**Status**
- Implemented (see fix writeup).

### 4) Durability Guard: Prevent “Persisted Empty openNotes While Panels Exist”

**Result**
- Added a deferral + bounded retry + repair mechanism to prevent persisting an “empty openNotes” snapshot when panels still exist.
- Adjusted `activeNoteId` correction logic so it does not clear focus to `null` when there is panel evidence that notes still exist.

**Why it matters**
- Fixes a confirmed failure mode where a transient mismatch (runtime openNotes temporarily 0 while panels still exist) caused the DB to be overwritten with `openNotes: []`, making a workspace appear empty after reload.

**Status**
- Spec documented and implemented (see fix writeup). Implemented in code on **2025-12-16** for traceability.

## Evidence / Validation Performed

### Type safety
- `npm run type-check` passes after the durability guard implementation (local verification).

### Behavioral confirmation (manual)
- After reload, component durable state restores and **running operations do not automatically resume** (expected UX: “preserve state, not behavior”).

### Logging improvements (operational visibility)
- New debug events exist for inconsistent persist conditions and repairs (see the durability guard fix doc).

## Where We Are vs. the Plan (Phases 1–6)

Mapping to `docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md`:

- **Phase 1–3 (Core store + hooks + persistence):** implemented and in active use.
- **Phase 4 (Eviction):** implemented with hard-safe gating and UI surfacing (see `docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md`).
- **Phase 5 (Component migration):** Timer/Calculator/StickyNote migrated (see report).
- **Phase 6 (Legacy cleanup):** may still be partially in-progress depending on remaining legacy registrations and fallback paths; verify against current codebase as part of final cleanup.

## Remaining Known Risks / Follow-Ups

1. **“Replay skipped / hot misclassification” mode** (DB has data but UI stays empty) can still occur if preview skips replay purely because a runtime is marked “hydrated”, even when runtime is actually empty. Track separately from the persisted-empty fix.
2. **Persist failure degradation UX**: ensure user messaging and decision flow is consistent across eviction paths (4-cap vs any higher-level caps).
3. **Test coverage**: expand unit/behavioral tests around:
   - inconsistent state guard (defer/repair path),
   - hot/cold classification correctness,
   - end-to-end switch/reload durability invariants.

## Quick “What To Check Before Calling It Done”

1. Create workspace with notes + components → switch away and back → verify state unchanged.
2. Create many workspaces to force 4-cap eviction → return to an evicted workspace → verify restored state.
3. Delete a component → reload → verify it does not reappear.
4. Reproduce the previous “persisted empty openNotes” condition → confirm DB no longer gets overwritten with `openNotes: []` while panels still exist.
