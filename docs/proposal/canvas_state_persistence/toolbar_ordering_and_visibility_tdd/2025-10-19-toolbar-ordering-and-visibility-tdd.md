# Technical Design Document — Toolbar Ordering & Initial Visibility Hardening

**Date**: 2025-10-19  
**Owner**: Canvas Platform Team  
**Status**: Draft (ready for review)  
**Related Plans**:  
- `docs/proposal/canvas_state_persistence/plan/2025-10-16-workspace-tab-highlight-plan.md`  
- `docs/proposal/canvas_state_persistence/plan/after/2025-10-19-toolbar-ordering-and-initial-visibility-plan.md`

---

## 0. Summary

We will guarantee that canvas workspace reloads restore the exact toolbar order and canvas composition persisted at shutdown, while ensuring the highlight animation only fires on explicit user re-selection. Work spans persistence schema (migrations extending `canvas_workspace_notes` and `panels`), hydration flow, integration with the recent panel-jumping fix (loadedNotes guard), and test/telemetry coverage. Isolation/reactivity anti-pattern rules remain non-applicable (no provider contract changes or new hooks); we confirm compliance in §6.

---

## 1. Requirements & Non-Goals

**Functional**
- Toolbar entries render in the same order as persisted within 1 render tick of hydration.
- All note panels and non-note components saved in the snapshot render before user interaction is possible.
- `workspace:highlight-note` dispatches only on user-initiated reselection.

**Non-Goals**
- Changing how non-note components are surfaced in the toolbar (still note-only).
- Reworking focus semantics between notes and arbitrary widgets (deferred).
- Introducing new isolation providers or context APIs.

---

## 2. Data Schema Extensions

We extend the existing persistence schema instead of introducing new tables. The toolbar ordering metadata lives in `canvas_workspace_notes` and panel taxonomy continues to leverage `panels`.

### 2.1 Migration 033: Add Toolbar Ordering Metadata

```sql
-- Add toolbar ordering + focus tracking
ALTER TABLE canvas_workspace_notes
ADD COLUMN toolbar_sequence INTEGER,
ADD COLUMN is_focused BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Enforce “only focused notes carry a sequence”
ALTER TABLE canvas_workspace_notes
ADD CONSTRAINT check_open_notes_have_sequence
CHECK (
  (is_open = FALSE AND toolbar_sequence IS NULL) OR
  (is_open = TRUE AND toolbar_sequence IS NOT NULL)
);

-- Backfill toolbar_sequence for notes currently open
WITH ordered_notes AS (
  SELECT note_id,
         ROW_NUMBER() OVER (ORDER BY updated_at) - 1 AS seq
  FROM canvas_workspace_notes
  WHERE is_open = TRUE
)
UPDATE canvas_workspace_notes cwn
SET toolbar_sequence = ordered_notes.seq
FROM ordered_notes
WHERE cwn.note_id = ordered_notes.note_id;

-- Pick the first open note as focused (legacy single-workspace assumption)
UPDATE canvas_workspace_notes
SET is_focused = TRUE
WHERE toolbar_sequence = 0
  AND is_open = TRUE;

-- Optional helper to surface the focus state quickly
CREATE UNIQUE INDEX idx_canvas_workspace_notes_focused
  ON canvas_workspace_notes (is_focused)
  WHERE is_focused = TRUE;

COMMENT ON COLUMN canvas_workspace_notes.toolbar_sequence IS 'Order of note in the workspace toolbar (0-indexed; NULL when closed)';
COMMENT ON COLUMN canvas_workspace_notes.is_focused IS 'Whether this note is currently highlighted/focused in the toolbar';
COMMENT ON COLUMN canvas_workspace_notes.opened_at IS 'Timestamp when the note entered the workspace';
```

Rollback (`033_add_toolbar_ordering.down.sql`):

```sql
ALTER TABLE canvas_workspace_notes
DROP CONSTRAINT IF EXISTS check_open_notes_have_sequence;

DROP INDEX IF EXISTS idx_canvas_workspace_notes_focused;

ALTER TABLE canvas_workspace_notes
DROP COLUMN IF EXISTS toolbar_sequence,
DROP COLUMN IF EXISTS is_focused,
DROP COLUMN IF EXISTS opened_at;
```

### 2.2 Migration 034: Extend Panel Type Enum

```sql
ALTER TABLE panels
DROP CONSTRAINT IF EXISTS check_panel_type;

ALTER TABLE panels
ADD CONSTRAINT check_panel_type
CHECK (
  type = ANY (
    ARRAY[
      'main',
      'branch',
      'editor',
      'context',
      'toolbar',
      'annotation',
      'widget'
    ]
  )
);

COMMENT ON COLUMN panels.metadata IS
  'JSONB metadata; for type ''widget'' include {"widget_type": "..."} for concrete widget identification';
```

Rollback (`034_extend_panel_types.down.sql`):

```sql
ALTER TABLE panels
DROP CONSTRAINT IF EXISTS check_panel_type;

ALTER TABLE panels
ADD CONSTRAINT check_panel_type
CHECK (
  type = ANY (
    ARRAY['main', 'editor', 'branch', 'context', 'toolbar', 'annotation']
  )
);
```

### 2.3 Relationship to Existing Schema

| Desired Field (TDD draft) | Actual Table / Column | Notes |
| --- | --- | --- |
| Toolbar ordering (`note_sequence`) | `canvas_workspace_notes.toolbar_sequence` | Added via migration 033; NULL when note closed. |
| Focused note flag | `canvas_workspace_notes.is_focused` | Ensures highlight and keyboard focus survive reload. |
| Toolbar opened timestamp | `canvas_workspace_notes.opened_at` | Enables chronological analytics if needed. |
| Panel positioning | `panels.position_x_world`, `panels.position_y_world`, `panels.width_world`, `panels.height_world`, `panels.z_index` | Already present; reused for hydration. |
| Panel classification | `panels.type` + `panels.metadata.widget_type` | Extended enum with generic `widget` bucket. |
| Panel payload | `panels.metadata` | Stores serialized panel state; no additional table required. |

This approach avoids duplicating data between new tables and existing persistence layers while keeping migrations reversible.

---

## 3. Hydration Sequence & Lifecycle

```mermaid
sequenceDiagram
  participant Boot as Next.js Route (app/canvas/page.tsx)
  participant Provider as CanvasWorkspaceProvider
  participant Store as WorkspaceDataStore
  participant UI as CanvasProvider / Toolbar

  Boot->>Provider: render(props.workspaceId)
  Provider->>Store: await loadWorkspace(workspaceId)
  Store->>Database: SELECT * FROM canvas_workspace_notes WHERE is_open = TRUE ORDER BY toolbar_sequence
  Store->>Database: SELECT * FROM panels WHERE note_id IN (open note ids) AND state = 'active'
  Database-->>Store: ordered openNotes + active panels
  Store-->>Provider: WorkspaceSnapshot { openNotes, panels }
  Provider->>UI: setHydrationSnapshot(snapshot); setIsHydrating(true)
  UI->>Store: seedPanels(panels) (uses loadedNotes guard)
  UI->>Toolbar: renderTabs(tabs) (no highlight event yet)
  UI->>UI: finish first paint
  UI->>Provider: onHydrationComplete()
  Provider->>UI: setIsHydrating(false)
  note over UI: highlight event now allowed on user reselection
```

Key notes:
- `CanvasWorkspaceProvider` sets `isHydrating` before fetching and exposes it via context so downstream handlers can suppress highlight events.
- `seedPanelsFromSnapshot(...)` pre-populates the shared `dataStore` (respecting the `loadedNotes` guard from the panel-jumping fix) before the first React paint, preventing any `(2000,1500)` default flashes.
- Toolbar receives ordered data prior to render; the highlight state is rendered but the glow dispatch is blocked while `isHydrating` is true.

---

## 4. Integration Points & Ordering Mode Decision

### 4.1 Integration with Panel Jumping Fix
- `CanvasProvider` still relies on `(dataStore as any).__loadedNotes` to avoid reseeding the main panel. `seedPanelsFromSnapshot` writes to the store before React mount; as a result `loadedNotes` already contains the hydrated note IDs and skips the default `(2000,1500)` seeding path.
- `CanvasWorkspaceProvider` owns an `isHydrating` state flag (exposed through the workspace context). `handleNoteSelect` and similar handlers check this flag to suppress highlight events triggered during the initial bootstrap.
- `seedPanelsFromSnapshot` signature:

  ```typescript
  function seedPanelsFromSnapshot(
    panels: Array<PanelSnapshot>,
    dataStore: DataStore,
    loadedNotes: Set<string>
  ): void;
  ```

  The helper no-ops when a store key already exists, ensuring idempotent hydration in hot-reload scenarios.

### 4.2 Ordering Mode: Manual Stable Ordering
- Decision: **Manual ordering with explicit resequencing** (preferred over MRU).
  - Matches user expectation that tab drag order persists.
  - MRU already represented by `focusedNoteId` (highlight), so we do not reorder automatically.
- Implementation:
  - When user reorders tabs, we update `toolbar_sequence` sequentially (0,1,2...).
  - When opening a new tab, we append at `max(toolbar_sequence)+1`.
  - Closing a tab compacts sequence by renumbering subsequent entries (to avoid sparse sequences).
- Persisted order drives hydration; highlight simply marks `focusedNoteId`.

---

## 5. Persistence Timing & Conflict Handling

### 5.1 Batching
- Maintain a `pendingBatchRef` inside `CanvasWorkspaceProvider` that records unsent updates (`toolbar_sequence`, `is_focused`, `main_position_*`).
- Schedule `flushBatch` with a 300 ms debounce whenever toolbar or panel mutations occur (reorder, add/remove, `pointerup` from drag/resize, widget reposition).
- On component unmount the provider awaits `flushBatch`; on `beforeunload` we send the payload via `navigator.sendBeacon('/api/canvas/workspace/flush', JSON.stringify(pendingUpdates))` to avoid data loss.

### 5.2 Conflict Resolution
- Use optimistic locking on `canvas_workspace_notes.updated_at`. Update statements include `WHERE updated_at = $expected OR $skipLock = true`.
- Default retry policy: one automatic refetch + retry when a conflict is detected; subsequent failures trigger a quiet workspace refresh (no user-facing error unless debugging).
- Emergency flush endpoint (`POST /api/canvas/workspace/flush`) bypasses optimistic locking to make `sendBeacon` idempotent.

### 5.3 Offline Alignment
- Batched updates continue to route through `canvasOfflineQueue` as `workspace_snapshot_update` tasks to match the Phase 1.5 camera persistence work.

### 5.4 Feature Flag & Rollout
- Environment variable `NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY=enabled` gates the new ordering/hydration path.
- Client provider checks the flag to choose between `loadWorkspaceWithOrdering` (new snapshot replay) and the legacy unordered loader. Server API mirrors the branching so both code paths remain testable.
- Integration test `test/e2e/workspace-feature-flag.spec.ts` toggles the flag to verify both behaviours; the rollout plan keeps the flag disabled until migrations are verified in staging.

---

## 6. Migration Strategy

### 6.1 Migration 033 — Toolbar Ordering Metadata
- Apply `migrations/033_add_toolbar_ordering.up.sql` (see §2.1) to add `toolbar_sequence`, `is_focused`, and `opened_at`.
- The script backfills `toolbar_sequence` based on `updated_at` ordering and marks the first open note as focused.
- Migration test: `tests/migrations/033-toolbar-ordering.test.ts` verifies forward/backward application on a fixture database and ensures the check constraint/index behave as expected.

### 6.2 Migration 034 — Panel Enum Extension
- Apply `migrations/034_extend_panel_types.up.sql` (see §2.2) to introduce the `widget` enum bucket.
- Migration test: `tests/migrations/034-extend-panel-types.test.ts` validates both the extended and restored constraints.

### 6.3 Rollback & Operational Checks
- Both migrations ship with `.down.sql` counterparts; run them in staging to confirm reversibility before production rollout.
- Post-migration verification:
  1. `SELECT note_id, toolbar_sequence, is_focused FROM canvas_workspace_notes WHERE is_open = TRUE ORDER BY toolbar_sequence;`
  2. `SELECT DISTINCT type FROM panels;` should include `widget`.
  3. Run highlighted Playwright smoke test to ensure hydration behaves before exposing the feature flag.

---

## 7. Test Specifications

| Test | Type | File (proposed) | Assertions |
| --- | --- | --- | --- |
| Toolbar order persists | Unit (RTL) | `__tests__/canvas/toolbar-ordering.test.tsx` | Hydrating with shuffled data renders DOM order matching `toolbar_sequence`; closing a tab compacts sequences. |
| Full panel replay | Playwright | `playwright/tests/canvas/canvas-replay.spec.ts` | Create note + widget (type `widget`, metadata.widget_type set), drag both, reload → both visible with saved positions (±2 px tolerance). |
| Highlight guard | Unit | `__tests__/canvas/handle-note-select.test.ts` | During hydration (`workspace.isHydrating=true`), reselecting active note does not fire `workspace:highlight-note`; once hydration completes it does. |
| Persistence batching | Integration | `tests/server/workspace-snapshot.spec.ts` | Simulate rapid reorder + drag events; confirm a single debounced DB write and `beforeunload` flush via `sendBeacon`. |
| Telemetry coverage | Integration | `tests/server/telemetry/workspace-toolbar-state.test.ts` | Snapshot replay emits `workspace_toolbar_state_rehydrated` with ordered `tabOrder`, panel counts, and hydration timing. |
| Migration scripts | Migration test | `tests/migrations/033-toolbar-ordering.test.ts`, `tests/migrations/034-extend-panel-types.test.ts` | Forward/backward migrations succeed; schema reverted cleanly on `down`. |

---

## 8. Telemetry Event Schema

Event name: `workspace_toolbar_state_rehydrated`

```json
{
  "workspaceId": "uuid",
  "focusedNoteId": "uuid | null",
  "tabOrder": ["uuid", "..."],
  "panelCount": 5,
  "componentBreakdown": {
    "note": 3,
    "widget": 2
  },
  "snapshotTimestamp": "2025-10-19T12:45:00Z",
  "hydrationDurationMs": 142
}
```

- Emitted after first successful hydration.
- Another event `workspace_snapshot_persisted` records save batches with `mutationCount` and `offlineQueued`.
- Alerts: if `panelCount` < persisted `tabOrder.length`, raise warning.

---

## 9. Open Questions

None. The earlier blockers (schema mapping, taxonomy, offline batching) are resolved in §2–§5 and captured in `docs/proposal/canvas_state_persistence/design/2025-10-19-tdd-blocker-resolution.md`.

---

## 10. Appendix

- **Isolation/reactivity compliance**: No new hooks or provider changes; we reuse existing contexts and the `loadedNotes` guard. Documented here to satisfy policy requirements.  
- **References**:  
  - Panel jumping fix summary (`docs/proposal/canvas_state_persistence/fixes/2025-10-18-panel-jumping-on-toolbar-switch.md`).  
  - Camera restoration follow-ups (`docs/proposal/canvas_state_persistence/plan/2025-10-15-camera-restoration-followups.md`).
