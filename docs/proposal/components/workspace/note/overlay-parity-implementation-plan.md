# Note Workspace Overlay-Parity Implementation Plan

## 0. Pre-Read and Safety
- ✅ Read `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`. Applicability: we must not couple new consumer hooks/UI to unstable provider contracts while refactoring the workspace engine. All context/APIs we add (snapshot refs, readiness flags) need backwards-compatible shims plus feature-flag guards, and we must avoid wiring UI components until the provider contract is fully stabilized.
- Compliance plan:
  - Gate all new state modules + context fields behind `NEXT_PUBLIC_NOTE_WORKSPACES_V2`.
  - Use defensive defaults when optional hooks run without the provider additions.
  - Extend providers first, land consumer changes (canvas, toolbar) only after the provider ships, mirroring the safe overlay flow.

## 1. Goal & Success Criteria
Deliver overlay-style persistence for note workspaces so they no longer depend on the single global `CanvasWorkspace` snapshot:
- **No wait requirement**: switching immediately after adding/dragging branch panels should persist + rehydrate without delay.
- **Independent persistence**: each workspace saves/loads its own payload (open notes, panel snapshots, camera, metadata) without touching `/api/canvas/workspace`.
- **Parity diagnostics**: logs/events match overlay flows (`note_workspace_hydrate_start/finish`, `snapshot_ready`, `autosave_flush_reason=workspace_switch`).
- **Flag safety**: behavior ships behind `NEXT_PUBLIC_NOTE_WORKSPACES_V2`, with fallback to the current path.

## 2. Current Gaps vs. Overlay Engine
1. Snapshot capture relies on autosave debounce rather than a “panel ready” signal, so fast switches miss new panels.
2. `CanvasWorkspaceProvider` still hydrates/persists globally unless flagged off, risking state drift.
3. `useNoteWorkspaces` only diffs open-note IDs; branch snapshots are replayed once per workspace hydration, not per note activation.
4. No telemetry/test coverage proves that a workspace switch flushes the complete snapshot before API calls.

## 3. Implementation Phases

### Phase 1 – Instrumentation & Tracing
1. Implement `branch-hydration-trace-plan.md`:
   - Add structured `debugLog` events in `CanvasPanel`, `usePanelPersistence`, `updatePanelSnapshotMap`, `captureCurrentWorkspaceSnapshot`, and `persistWorkspaceNow`.
   - Include workspace ID, note ID, panel ID, timestamp, and “readiness” boolean.
2. Add counters for `snapshot_pending_panels` and `snapshot_ready_panels` so we can assert when all branch metadata is written.
3. Manual runs:
   - Case A: create branch → immediately switch → capture logs.
   - Case B: wait 3 s before switching → capture logs.
   - Determine exact delta (e.g., `updatePanelSnapshotMap` fires late) to inform readiness gate.

_Status:_ initial tracing hooks (CanvasPanel mount/content readiness, panel persistence commit/start, snapshot capture/save attempts) landed with this change so we can begin collecting the timelines for Cases A/B. Use `node scripts/query-note-workspace-trace.js --minutes 10 --workspace <id>` to pull the new events from `debug_logs` while reproducing the fast vs. wait flows.
_Findings:_ Floating-toolbar branch creation was calling into the annotation toolbar via DOM clicks, which silently failed whenever the buttons weren’t mounted. As of 2025‑11‑19 both the floating toolbar and panel Tools → Actions menu call `window.app.createAnnotation(type)` (with logs / button fallback), so you should now see `insert_annotation_*` / `panel_tools_call_app_create_annotation` in traces. Pending work is to ensure hydration replays those saved panels (branch still vanishes on switchback in Case A), so trace Case B (wait ≥3 s) to capture the hydration diff.

_Latest Findings (post-instrumentation, 2025‑11‑19):_
- `panel_pending` / `panel_ready` now appear when branch creation flows through `annotation-toolbar-trigger` → `usePanelCreationEvents` — the pending guard is firing.
- Branches still disappear if you switch before any snapshot/save includes them: pending/ready fires, panels unmount on switch, but no `workspace_switch_capture`/save runs with the branch present. Minimap can still show the branch from the last in-memory snapshot while the rehydrated canvas omits it. Fix needs to (a) ensure switch snapshots wait for pending to clear and (b) force a snapshot/save after ready before unmount/switch when possible.

### Phase 2 – Ready Signal & State Module
1. Create `lib/note-workspaces/state.ts`:
   - Tracks `openNotes`, `panelSnapshots`, `camera`, `activeNoteId`, and a `snapshotRevision`.
   - Exposes `markPanelSnapshotReady(panelId, workspaceId)` when datastore writes complete.
2. In `usePanelPersistence` (and any other panel mutation hook), call `markPanelSnapshotReady` after the datastore transaction commits, carrying friendly title + metadata.
3. Maintain a per-workspace `snapshotPendingSet`: when it hits zero, emit `note_workspace_snapshot_ready` (with revision) so autosave/switch logic can flush immediately.

### Phase 3 – Overlay-Style Capture & Hydrate
1. **Capture path** (mirrors `useOverlayLayoutPersistence`):
   - Before switching workspaces or when autosave fires, call `captureWorkspaceSnapshot(workspaceId)` which composes:
     - `openNotes` from `openWorkspaceNotesRef`.
     - `panelSnapshots` from the state module (only “ready” panels).
     - `camera` from `useCanvasViewport`.
     - `metadata` (active note, toolbar state).
   - Serialize and compare hash; skip save when unchanged.
2. **Hydrate path**:
   - On switch: `previewWorkspaceFromSnapshot` clears note-layer data store, installs serialized panels, reopens notes greedily (no `/api/canvas/workspace` calls).
   - After preview, call adapter `loadWorkspace` to fetch the persisted payload; reconcile with preview (log diffs, merge remote updates).
   - Ensure `workspaceSnapshotRevision` increments each time, and propagate to `useCanvasNoteSync` to force a render.
3. Remove all `/api/canvas/workspace` writes when `NEXT_PUBLIC_NOTE_WORKSPACES_V2=true` (already partially done—verify no stragglers).

### Phase 4 – Autosave Flush Integration
1. In `useNoteWorkspaces`, subscribe to the `snapshot_ready` signal. When switching or when the toolbar requests a save:
   - If pending panels exist, wait up to `SNAPSHOT_READY_TIMEOUT` (e.g., 300 ms) for the ready event while showing a spinner/pill.
   - Once ready or timed out, call `persistWorkspaceNow(reason)` with `flushPendingSave("workspace_switch")`.
2. Ensure the autosave debounce resets only after the flush completes so we don’t drop writes.
3. Add a per-workspace `lastFlushedSnapshotRevision` so duplicate flushes are skipped.

### Phase 5 – Testing & Telemetry
1. **Unit tests**
   - `note-workspaces/state`: pending vs. ready transitions, hash diff guard.
   - `useCanvasNoteSync`: renders on `workspaceSnapshotRevision` changes even with same note IDs.
   - `useNoteWorkspaces`: `snapshot_ready` triggers immediate save before workspace switch.
2. **Integration/Playwright**
   - Scenario: create branch, switch immediately; verify branch present after switch and after reload.
   - Scenario: spam workspace switches; ensure no branch disappearance or title flicker.
3. **Telemetry**
   - `note_workspace_snapshot_pending` (with counts) and `note_workspace_snapshot_ready`.
   - `note_workspace_autosave_flush` events (reason, latency, pending count).
   - Alert if `snapshot_ready_timeout` fires frequently.

### Phase 6 – Rollout & Backout
1. Keep everything behind `NEXT_PUBLIC_NOTE_WORKSPACES_V2` + optional `NOTE_WORKSPACES_OVERLAY_PARITY` override (localStorage) for QA.
2. Staging checklist:
   - Enable flag, run tracing to validate pending → ready timelines.
   - Check `/api/debug/log` is no longer spammed with `setCanvasItems_SKIPPED_SAME_REF`.
   - Confirm default workspace seeding still works.
3. Production rollout:
   - Gradually enable flag (e.g., 10% of sessions via remote config).
   - Monitor telemetry dashboards; roll back by flipping the flag off if snapshot_ready timeouts spike or branch disappearance reoccurs.
4. Cleanup:
   - Once stable, delete legacy CanvasWorkspace persistence calls, remove guard code, and update docs (`docs/proposal/workspace/hydrating/optimistic-overlay-hydration-plan.md`) to mark parity complete.

## 4. Deliverables
- Code changes across:
  - `lib/hooks/annotation/use-note-workspaces.ts`
  - `lib/hooks/annotation/use-canvas-note-sync.ts`
  - `lib/workspace/workspace-storage.ts` (state helpers)
  - `components/annotation-app-shell.tsx` (workspace switching)
  - `components/canvas/canvas-workspace-context.tsx` (legacy skip)
- Telemetry schema updates in `lib/telemetry/events.ts`.
- Updated docs:
  - `docs/proposal/components/workspace/note/plan.md` (mark steps complete as shipped).
  - `docs/fixes/` entry summarizing parity rollout once done.

## 5. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Snapshot-ready signal never fires (bug) | Add timeout + telemetry + manual kill switch; log stuck pending IDs. |
| Partial payloads replay (missing panels) | Hash diff + revision gating; integration tests verifying branch presence after rapid switches. |
| Provider/consumer API drift (anti-pattern) | Ship provider/state changes behind flag first, keep consumers tolerant, follow isolation-reactivity guidance. |
| Telemetry flood (`/api/debug/log`) | Batch logs, or gate under verbose flag. |

## 6. Timeline (Rough)
1. Day 0–1: Instrumentation + tracing.
2. Day 2–3: Build state module + ready signal.
3. Day 4–5: Capture/hydrate refactor + autosave flush integration.
4. Day 6: Tests + docs + telemetry dashboards.
5. Day 7: Staging rollout and validation.
6. Day 8+: Production flag enable, monitor, cleanup.

Once these phases complete, note workspaces achieve overlay parity: every workspace switch persists/rehydrates immediately with no manual waiting, and the global workspace dependency is eliminated.
