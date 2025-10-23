# Canvas Snapshot Duplication Remediation Plan

## Context
- Live instrumentation confirms multiple entries for the same branch panel. Latest sample (`debug_logs.id = 9172698`) shows four copies of `03c4051a-ecc1-44ad-8821-7d445ef51f07::branch-b378cc79-79fc-4716-a841-1953d3dbdfe9` alongside two distinct `main` panels.
- `WidgetStudioConnections` consumes the raw `canvasItems` array, so every duplicate branch (or cross-note `main`) is rendered, producing repeated React keys (`main::branch-b378cc79-79fc-4716-a841-1953d3dbdfe9`).
- Current persistence writes `canvasItems` to localStorage verbatim. Any duplicate introduced during hydration, preview creation, or event races is saved and rehydrated on every load.
- Isolation/reactivity anti-patterns guideline was reviewed (2025-10-23); this plan touches only canvas state/persistence hygiene, so no provider contract risks are introduced.

## Goals
1. Keep `canvasItems` unique at the point of mutation so duplicate panels never persist in memory.
2. Sanitize legacy snapshots (save + restore) to clear already-corrupted data.
3. Surface deduplication activity in `debug_logs` for observability and rollback.
4. Add regression coverage ensuring ghost duplicates cannot reappear silently.

## Implementation Steps

### 1. Centralized Deduplication in `setCanvasItems`
- **File**: `components/annotation-canvas-modern.tsx`
- Wrap `_setCanvasItems` so every update runs through a dedupe pass before state is returned.
  - Iterate the array in reverse order; keep the *last* occurrence of each composite key (preserves the user’s most recent movement) and rebuild the result in original order by pushing into a temporary array and calling `.reverse()` once.
  - Algorithm sketch:
    ```ts
    function dedupeCanvasItems(items: CanvasItem[], fallbackNoteId: string): CanvasItem[] {
      const seen = new Set<string>()
      const dedupedReversed: CanvasItem[] = []

      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        const noteForKey = item.noteId ?? fallbackNoteId
        const panelId = item.panelId ?? 'unknown'
        if (!noteForKey) {
          debugLog({ component: 'AnnotationCanvas', action: 'dedupe_skip_missing_note', metadata: { index: i, panelId } })
          continue
        }
        const key = item.storeKey ?? ensurePanelKey(noteForKey, panelId)
        if (seen.has(key)) continue
        seen.add(key)
        if (!item.noteId) item.noteId = noteForKey
        if (!item.storeKey) item.storeKey = key
        dedupedReversed.push(item)
      }

      return dedupedReversed.reverse()
    }
    ```
  - Composite key = `storeKey` if present, otherwise `ensurePanelKey(noteId,panelId)` with null guards.
  - Emit `debugLog({ component: 'AnnotationCanvas', action: 'canvasItems_deduped_at_source', metadata: { removed, remaining } })` when entries are dropped.
- Export a small helper (`dedupeCanvasItems`) only for reuse in snapshot save/restore (steps 2–3).
- Complexity: O(n) per update (reverse pass + final `.reverse()`). Document in code comment to avoid regressions; watch for hot paths that call `_setCanvasItems` repeatedly.
- Note: keep dedupe inside the wrapper to avoid repeating it across callers and to handle multi-pass updates (hydration, preview panels, drag events).

### 2. Snapshot Hygiene (Restore Path)
- **File**: `components/annotation-canvas-modern.tsx`
- After `ensureMainPanel(...)` during snapshot restoration (`~line 1628`):
  - Apply `dedupeCanvasItems` so legacy snapshots are cleaned on load (while still keeping the latest occurrence).
  - Emit `debugLog({ component: 'AnnotationCanvas', action: 'snapshot_items_deduped', metadata: { noteId, before, after } })` when changes occur.
  - Proceed with existing corruption detection and data-store sync using the deduped array (now reflecting the user’s latest positions).

### 3. Snapshot Hygiene (Save Path)
- **File**: `components/annotation-canvas-modern.tsx`
- In the auto-save effect (`~line 2410`):
  - Call `dedupeCanvasItems(canvasItems, noteId)` primarily as a sanity check; if the returned length differs, log `canvasItems_deduped_on_save` (Step 1 should have caught everything).
  - Always pass the deduped result to `saveStateToStorage`; avoid redundant work by skipping additional processing when lengths already match.

### 4. Regression Coverage
- **File**: `__tests__/integration/workspace-snapshot.test.ts`
- Extend the scenario to:
  - Inject duplicated branch entries into the mocked snapshot payload.
  - Reload and assert:
    - Only one branch panel survives in `canvasItems`.
    - `debug_logs` contains `snapshot_items_deduped` once (hook into existing test helpers).
    - `WidgetStudioConnections` renders exactly one path without warnings (spy on `console.error`/`console.warn` or inspect the SVG node list to confirm the duplicate-key warning is eliminated).

### 5. One-Time Snapshot Migration
- **File**: `lib/migrations/dedupe-snapshots-v1.ts` (client-side helper executed in idle slices)
- Trigger during app bootstrap if `localStorage.getItem('canvas-migration:dedupe-v1') !== 'complete'`:
  - Schedule work via `requestIdleCallback` (50 ms budget per slice). Resume across frames until all snapshot keys are processed; fall back to `setTimeout` when unavailable.
  - For large payloads, optionally offload to a Web Worker (feature-detected) to avoid blocking the main thread.
  - Apply `dedupeCanvasItems` for each key, write back only when changes occur.
  - If cumulative migration time exceeds 1 s, pause, log `CanvasMigration` warning, and continue on the next idle window.
  - On success, set the completion flag and emit `debugLog({ component: 'CanvasMigration', action: 'snapshot_items_migrated', metadata: { keysProcessed, durationMs } })`.
- Provide a utility entry point (`runCanvasSnapshotDedupeMigration`) to support manual invocation in QA builds.

### 6. Contingency / Rollback
- Feature flag: `const ENABLE_CANVAS_DEDUPE = process.env.NEXT_PUBLIC_CANVAS_DEDUPE !== 'false'`.
  - When disabled, the wrapper still executes dedupe but emits `canvasItems_deduped_emergency` logs and notifies Sentry; the flag only suppresses ancillary work (e.g., migration) so we never knowingly persist duplicates.
  - Snapshot save/restore continue deduping regardless of flag state, ensuring consistent data when rolling forward again.
- Keep telemetry on `canvasItems_deduped_at_source` removals; unexpected spikes can trigger investigation before rolling back.
- Document operator steps (set env flag, redeploy, monitor logs, re-enable after fix) in `RUNBOOK.md`.

### 7. Edge Case Handling
- Missing `noteId`: attempt to fall back to provider noteId or top-level `noteId` prop. If unresolved, retain the panel, tag it with a synthetic key (`unknown::<uuid>`), and surface a UI warning banner (`CanvasPanelWarnings`) so users know remediation is needed. Log `dedupe_missing_note_id`.
- Missing `panelId`: treat as `'unknown'` for key construction, retain panel, and log `dedupe_missing_panel_id`.
- Malformed `storeKey`: rebuild via `ensurePanelKey`; if validation fails, retain the original key and mark the panel as suspect (adds to warnings list) rather than dropping it.
- Non-panel items bypass dedupe but preserve order.
- Never throw; always return the best-effort deduped array while collecting warning metadata for downstream UI.

## Verification Checklist
- Manual: recreate current duplication scenario, reload, confirm the UI renders cleanly and `debug_logs` records a `snapshot_items_deduped` action with `before > after`. Validate that the warning banner appears for panels missing context and that it clears once metadata is restored.
- Automated: run `npm test -- workspace-snapshot.test.ts`.
- Execute unit tests covering `dedupeCanvasItems` (identity, order preservation, edge handling).
- Console: ensure no `Encountered two children with the same key` warning after fix; confirm `canvasItems_deduped_on_save` logs remain zero.

## Open Questions / Follow-ups
- Evaluate whether IndexedDB queue entries also need dedupe (if they cache panel snapshots).
- Monitor `canvasItems_deduped_at_source` metrics for a few days; large counts could indicate upstream regression that warrants deeper fix.
- Performance acceptance:
  - Measure P50/P95/P99 dedupe runtime on target devices (goal: < 5 ms / < 15 ms / < 50 ms respectively for ≤ 1 000 items); log and investigate outliers.
  - Document realistic auto-save budget (expect 40–120 ms due to serialization + `localStorage.setItem`); consider async/off-thread persistence as follow-up if UX suffers.
  - No measurable frame drops during drag interactions (spot-check via performance tab).
  - If `canvasItems.length` exceeds 5 000, record `canvasItems_deduped_large_payload` for manual analysis.
- Add unit tests:
  - Order preservation: confirm siblings retain relative ordering while keeping the latest duplicate.
  - Edge-case handling: ensure panels with missing metadata surface warnings but remain in the array.
- Concurrent tab conflict handling (timestamped snapshots, storage events) remains open; evaluate as Phase 2 follow-up once dedupe is stable.

Prepared: 2025-10-23  
Owner: Canvas Platform Team (persistence hardening stream)
