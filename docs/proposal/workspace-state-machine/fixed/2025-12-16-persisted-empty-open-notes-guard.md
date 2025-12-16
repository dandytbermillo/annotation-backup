# Fix Spec: Prevent “Persisted Empty openNotes” When Panels Exist (Live-State / V2)

## Problem Statement

We have confirmed a data-loss class bug where a workspace is persisted to the database with:

- `openNotes: []`
- `activeNoteId: null`

even though the workspace still has at least one note panel (`panelCount > 0`).

After a reload or cold restore, the workspace can appear “empty” because the persisted `openNotes` and `activeNoteId` were erased during an inconsistent transitional state.

This doc specifies a *durability guard* to prevent persisting an “empty openNotes” payload when the runtime state is in flux.

## Evidence (Workspace 4)

The observed log chain (user report) shows:

- `persist_by_id_start` with `openCount` dropping from 1 → 0
- `build_payload_corrected_stale_active_note` with `openNoteCount: 0` and `correctedActiveNoteId: null`
- persistence proceeding even though `panelCount` remained non-zero at that moment

The current code path that explains this behavior:

- `openNotes` is read from runtime slots via `getWorkspaceOpenNotes(...)` (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:284-315`).
- In live-state, the system explicitly refuses to infer `openNotes` from membership (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:492-518`).
- When `openNotes` is empty, `activeNoteId` is “corrected” to null/first open note (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:520-540`).

So if runtime open-notes temporarily drops to zero while panels still exist, we can persist an empty `openNotes` array and null `activeNoteId`, creating a durable “empty workspace”.

## Root Cause

In **live-state** mode, the system treats runtime open-notes as authoritative, but runtime can be temporarily inconsistent during transitions:

- panels still exist in DataStore/caches (or are still visible)
- runtime open-notes momentarily reads as empty (0)

Because live-state forbids inference (to avoid resurrecting intentionally closed notes), persistence chooses “empty is truth” and writes the empty state to DB.

This is safe against resurrection, but unsafe against **silent erasure** during transient mismatch.

## Design Goals

1. **No silent data loss**: never persist an “empty openNotes” payload when there is strong evidence the workspace still contains notes (panels exist).
2. **Live-state correctness**: preserve the rule “don’t infer from stale membership” unless we can justify the inference source as “present, observed UI state”.
3. **Bounded behavior**: avoid infinite retry loops; degrade to a user-visible choice if needed.
4. **Backwards compatible**: do not require component-level changes.

## Proposed Fix (Durability Guard)

### A) Detect the inconsistent state at payload-build time

During `buildPayload()`:

- `observedNoteIds` is already derived from `panelSnapshots` (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:298-303`).
- `openNotes` is already read via `getWorkspaceOpenNotes(...)` (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:284-315`).

Add a guard condition:

- `storedOpenNotesForWorkspace.length === 0`
- `observedNoteIds.size > 0` (meaning panels exist, therefore notes exist)

When this condition is true, treat the workspace state as “inconsistent / unsafe to persist”.

### B) Choose one of two safe actions (recommend hybrid)

**Option 1 — Defer (preferred first response)**

- Skip persisting for this attempt.
- Schedule a short retry (e.g., 250–500ms) to allow runtime open-notes to catch up.
- Use a small per-workspace retry counter to prevent infinite loops; after N retries, enter “degraded” behavior (see below).

Rationale: avoids resurrecting notes if the panels are about to be removed (e.g., user just closed the last note and the panel cleanup is in-flight).

**Option 2 — Repair (preferred fallback after bounded retries)**

If the inconsistency persists for N retries:

- Seed runtime `openNotes` from `observedNoteIds` (the presence of panels is direct evidence the notes are present).
- Set `mainPosition` from the panel snapshot / `resolveMainPanelPosition(...)`.
- Commit via `commitWorkspaceOpenNotes(...)` so runtime + membership + caches are synchronized.
- Proceed with persistence.

Rationale: once the mismatch persists beyond a short window, continuing to skip persistence can cause “never saving” behavior. Repair makes persisted state consistent with the actually-present panels.

### C) Make `activeNoteId` correction conditional on “truly empty”

Currently, `activeNoteId` is corrected using open-notes only (`lib/hooks/annotation/workspace/use-workspace-persistence.ts:520-540`).

Change the rule:

- Only clear/correct `activeNoteId` to null when **both**:
  - `openNotes` is empty, and
  - `observedNoteIds.size === 0` (no panels)

If panels exist, do not clear `activeNoteId` to null as part of a persistence pass; instead:

- Keep `activeNoteId` if it is among `observedNoteIds`, otherwise
- fall back to a stable note choice derived from panels (e.g., “first observed note ID”).

This prevents a single inconsistent tick from erasing focus state durably.

## Degraded Mode / User Choice

If after bounded retries the mismatch persists and repair is not applied (or repair fails), the system should:

- avoid evicting the workspace while it is in an unsafe-to-save state
- notify the user that the workspace cannot be made durable
- offer choices:
  - Retry save
  - Force close/evict (explicitly acknowledging potential data loss)

This aligns with the “hard-safe eviction” principle: do not destroy state that cannot be made durable.

## Logging / Observability

Add explicit debug events for:

- `persist_blocked_inconsistent_open_notes` (openNotes empty, panels exist)
- `persist_retry_inconsistent_open_notes` (retry attempt number)
- `persist_repaired_open_notes_from_panels` (repair applied; count of noteIds seeded)
- `persist_degraded_inconsistent_open_notes` (entered degraded mode / user prompt shown)

These should include:

- workspaceId
- observedPanelNoteIds count
- openNotes count (runtime)
- activeNoteId (before/after)
- retryAttempt

## Testing & Verification

### Unit/Behavioral Tests

Add tests covering:

1. **Guard triggers**: openNotes empty + panels non-empty ⇒ persistence is deferred or repaired (depending on chosen strategy).
2. **No erase of focus**: activeNoteId is not cleared to null while panels exist.
3. **Bounded behavior**: after N retries, system enters degraded mode (no infinite loop).
4. **No resurrection**: if panels are removed and openNotes empty, payload persists empty (this is the legitimate “workspace truly empty” case).

### Manual Repro Checklist

1. Create a workspace with 1 note open (panel exists) and confirm it persists normally.
2. Trigger the known transition that produces `panelCount > 0` but `openNotes = 0` (e.g., rapid switching + immediate save).
3. Confirm:
   - DB payload does *not* become `openNotes: []` while panels still exist.
   - `activeNoteId` remains non-null if a panel exists.
4. Reload and verify the workspace is not empty.

## Relationship to the “Replay Skipped” Failure Mode

This fix addresses the confirmed “persisted empty” mode (Workspace 4). A separate, complementary fix is recommended for “DB has data but UI is empty”:

- Tighten preview “hot skip” so “hot” means “runtime has real state”, not merely `isWorkspaceHydrated(...)` (`lib/hooks/annotation/workspace/use-workspace-snapshot.ts:1166-1223`).

That change is out of scope for this doc but should be tracked as the second half of a complete solution.

