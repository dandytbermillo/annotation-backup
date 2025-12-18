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
- `docs/proposal/workspace-state-machine/improvement/2025-12-16-degraded-mode-ui-reset-plan.md` ✅ COMPLETE

**Test Documentation**
- `docs/proposal/workspace-state-machine/test/2025-12-16-hard-safe-eviction-manual-tests.md`

**Fix writeups**
- `docs/proposal/workspace-state-machine/fixed/2024-12-14-workspace-component-store-bugs-fix.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-15-component-deletion-persistence-fix.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-16-persisted-empty-open-notes-guard.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-17-revision-recovery-on-entry-switch.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-17-all-workspaces-busy-capacity-fix.md`
- `docs/proposal/workspace-state-machine/fixed/2025-12-18-prune-transient-mismatch-fix.md` ✅ NEW

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

### 4) Durability Guard: Prevent "Persisted Empty openNotes While Panels Exist"

**Result**
- Added a deferral + bounded retry + repair mechanism to prevent persisting an "empty openNotes" snapshot when panels still exist.
- Adjusted `activeNoteId` correction logic so it does not clear focus to `null` when there is panel evidence that notes still exist.

**Why it matters**
- Fixes a confirmed failure mode where a transient mismatch (runtime openNotes temporarily 0 while panels still exist) caused the DB to be overwritten with `openNotes: []`, making a workspace appear empty after reload.

**Status**
- Spec documented and implemented (see fix writeup). Implemented in code on **2025-12-16** for traceability.

### 5) Degraded Mode UI Reset (User Recovery from Persist Failures)

**Result**
- When 3+ consecutive eviction persist failures occur (e.g., offline), the system enters "degraded mode" which blocks cold workspace opens to prevent data loss.
- A **DegradedModeBanner** component provides an explicit **Retry** button that calls `resetDegradedMode()`.
- `navigator.onLine` guardrail: clicking Retry while offline shows "You are offline" toast; clicking while online resets degraded mode.
- Moved degraded UX ownership from hook-side toast to UI-driven banner (state-driven, no toast spam).

**Why it matters**
- Before this fix, the only way to recover from degraded mode was to reload the page.
- Users now have an explicit recovery action without losing their current session state.
- Eliminates duplicate toasts from multiple `ensureRuntimePrepared` call sites.

**Status**
- Implemented and tested on **2025-12-16** (see improvement doc). All 13 test steps passed.
- **2025-12-17 Update:** Fixed banner re-entry bug by removing dismiss (X) button. Degraded mode is a hard gate for data loss prevention — allowing users to hide the only explanation creates confusion. User must click Retry to dismiss.
- **2025-12-18 Update:** Full manual test (Test 3, all 13 steps) re-verified successfully with prune fix in place. Workspace 8 opened with content intact after degraded mode recovery.

**Files created/modified**
- `components/workspace/degraded-mode-banner.tsx` (NEW, updated 2025-12-17 to remove X button)
- `components/annotation-app-shell.tsx` (+1 import, +8 lines render)
- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` (removed hook-side toast)

### 6) Revision Recovery on Entry Switch (Persist 412 Fix)

**Result**
- When entry switching causes refs to reset, the persist operation now recovers the workspace revision from DB before attempting to save.
- Eliminates HTTP 412 (Precondition Failed) errors that occurred when `workspaceRevisionRef` was empty after remount.

**Why it matters**
- Entry switching (annotation → home → annotation) caused component unmount/remount, resetting refs.
- Component store dirty state (e.g., running timers) persisted across remounts.
- Eviction tried to persist with empty revision → 412 error → blocked eviction → toast spam.
- Users experienced "Workspace save failed" toasts during normal navigation.

**Status**
- Implemented and tested on **2025-12-17** (see fix doc).

**Files modified**
- `lib/hooks/annotation/use-note-workspaces.ts:619-655` (revision recovery logic)

**Key behaviors:**
| Scenario | Action | Result |
|----------|--------|--------|
| Revision unknown, load succeeds, local has data | Use loaded revision | Save proceeds normally |
| Revision unknown, load succeeds, local emptier than DB | Skip save, return `true` | Eviction proceeds, DB preserved |
| Revision unknown, workspace 404 | Skip persist, return `true` | Eviction proceeds (nothing to persist) |
| Revision unknown, load fails (network) | Return `false` | Eviction blocked (safe) |

**Data loss prevention guard:** When loading revision, also compare local vs DB payload. If local is emptier (panels=0 but DB has panels, etc.), skip save to prevent overwriting good DB data with stale/empty local data.

**Limitations:** This guard only catches zero vs non-zero cases. It does NOT catch partial staleness (e.g., local has 2 panels, DB has 5) or content differences with same counts. It's a guardrail for the remount-empty case, not a complete "no stale overwrite" solution.

**Note on dirty state:** Whether dirty state persists across entry switches depends on whether the entry is truly remounted vs hidden (pinned entries feature) and whether state is store-backed vs ref-backed. It's more accurate to say "dirty state can exist even when revision ref is empty" rather than "dirty state always persists."

### 7) All-Workspaces-Busy Capacity Enforcement Fix

**Result**
- When all workspaces at 4-cap have active operations (running timers), the system now blocks workspace opening and shows a toast instead of silently exceeding capacity.

**Why it matters**
- Previously, when all 4 workspaces had running timers and user opened a 5th workspace:
  - No eviction candidate could be found (all had active operations)
  - System silently created a 5th runtime, exceeding capacity
  - No toast was shown
- Now the system properly blocks the operation and shows "All workspaces are busy" toast.

**Status**
- Implemented and tested on **2025-12-17** (see fix doc).

**Files modified**
- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:325-341` (capacity enforcement check)
- `lib/workspace/runtime-manager.ts:229-236` (new notification function)
- `lib/workspace/eviction-toast.ts:39-48` (new toast message)

### 8) Prune Transient Mismatch Guard (Prevents Empty Workspace Bug)

**Result**
- Added a guard in `pruneWorkspaceEntries` to skip pruning when canvas reports 0 observed notes but runtime has N notes.
- This prevents incorrect "stale note" removal during transient windows (cold opens, render delays, visibility changes, snapshot cache gaps).

**Why it matters**
- During transient mismatches, the canvas hasn't caught up to runtime state yet.
- The existing prune logic would mark all runtime notes as "stale" (not on canvas) and remove them.
- This caused permanent data loss: `openNotes: []` was persisted to DB.

**Status**
- Implemented on **2025-12-18** (see fix doc).

**Files modified**
- `lib/hooks/annotation/use-note-workspaces.ts:533-550` (transient mismatch guard)

**Why this is safe**
- When users intentionally close all notes, `closeWorkspaceNote` updates runtime immediately → `runtimeNoteIds.size` becomes 0.
- The existing guard (lines 519-531) catches that case (`runtimeNoteIds.size === 0`).
- The only time `observed=0 && runtime>0` is during transient mismatches.

**Debug log**
- New event: `workspace_prune_skipped_transient_mismatch` when guard triggers.

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

1. **"Replay skipped / hot misclassification" mode** (DB has data but UI stays empty) can still occur if preview skips replay purely because a runtime is marked "hydrated", even when runtime is actually empty. Track separately from the persisted-empty fix.
2. ~~**Persist failure degradation UX**: ensure user messaging and decision flow is consistent across eviction paths (4-cap vs any higher-level caps).~~ **RESOLVED** — Implemented `DegradedModeBanner` with Retry button (2025-12-16).
3. **Test coverage**: expand unit/behavioral tests around:
   - inconsistent state guard (defer/repair path),
   - hot/cold classification correctness,
   - end-to-end switch/reload durability invariants.

## Quick "What To Check Before Calling It Done"

1. Create workspace with notes + components → switch away and back → verify state unchanged.
2. Create many workspaces to force 4-cap eviction → return to an evicted workspace → verify restored state.
3. Delete a component → reload → verify it does not reappear.
4. Reproduce the previous "persisted empty openNotes" condition → confirm DB no longer gets overwritten with `openNotes: []` while panels still exist.
5. **Degraded mode recovery (Test 3, Steps 1-13):**
   - Fill 4-cap → go offline → create dirty state → trigger 3 blocked evictions → enter degraded mode
   - Click Retry while offline → "You are offline" toast appears, banner stays
   - Go online → click Retry → banner hides, "Retry enabled" toast appears
   - Click cold workspace → should open successfully
