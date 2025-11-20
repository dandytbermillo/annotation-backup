# Note Workspace Overlay-Parity Fix Plan

Goal: non-main panels must persist across workspace switches even after creating new notes. Eliminate shared datastore pitfalls and make snapshots deterministic per workspace.

Applicability of isolation/reactivity anti-patterns: applicable. We must avoid provider/consumer drift and UI-only gating. Changes must be behind flags or backward-compatible shims.

Scope
- Note workspace persistence (capture/hydrate) for V2 flag.
- Panel snapshot ownership and replay semantics.
- Datastore isolation to prevent cross-workspace bleed.
- Tests/telemetry to lock behavior.

Out of scope
- UI redesign; only persistence/hydration mechanics.
- Legacy `/api/canvas/workspace` path (except to remove use under V2).

Plan
1) Immediate guard (stop the drop now)
   - Keep `snapshotOwnerWorkspaceIdRef` set to the active workspace outside of explicit preview; only clear during cross-workspace preview.
   - In datastore mutation handler, if owner is null, fall back to `currentWorkspaceId` (flagged path) so `updatePanelSnapshotMap` never skips mutations.
   - Always replay the cached snapshot on workspace switch (panels + open notes + camera), even if hashes match, to avoid stale in-memory state.
   - Keep `panel_snapshot_skipped_no_owner` logs to validate the guard.
   - Note: owner fallback is temporary; after datastore isolation lands, keep replay-on-switch but drop the fallback.

2) Per-workspace datastore isolation (structural fix, make concrete)
   - Create a per-workspace store registry (e.g., `workspaceStores: Map<workspaceId, DataStore>`), injected by a V2 note-workspace provider. Panel hooks (persistence/snapshot collection) pull the store for the active workspace from this registry, not from the shared CanvasWorkspaceProvider.
   - For V2, bypass CanvasWorkspaceProvider entirely for note workspaces; keep the old provider for legacy paths. Pending persists/unload handlers in the legacy provider become no-ops under V2.
   - On switch: clear only the store for the target workspace (not the global store), then replay its cached snapshot into that store.
   - Keep store events scoped so mutations from workspace A cannot mutate B.

3) Authoritative snapshot ownership + replay freshness
   - Track backend revision with each cached snapshot; force replay when revision or workspace changes.
   - After preview/apply, re-set owner to active workspace and keep it set.
   - If owner ever null during mutation, log a warning and reattach to active workspace when safe.

4) Capture/switch/hydrate sequence (precise steps)
   - Under V2, remove `/api/canvas/workspace` writes/reads from the note flow; adapter owns save/hydrate.
   - Before switch:
     1) Ensure owner is set to the current workspace.
     2) Bounded wait: implement a helper that awaits a per-workspace pending-panels promise (or drain of the mutation queue) with `Promise.race(timeout)`. On timeout, log `snapshot_pending_timeout` and proceed with a fresh collect (no bail).
     3) Capture snapshot from the per-workspace store; persist to adapter (save).
     4) Set owner to the target workspace.
     5) Replay cached snapshot for the target workspace into its store (panels + open notes + camera) unconditionally.
     6) Fetch latest snapshot from adapter; merge rule: if adapter revision differs from cached, replace the cached snapshot wholesale (panels/open notes/camera) and replay; if the revision matches, keep cached (no merge-by-panel). Only merge main positions if we explicitly decide to, otherwise favor adapter on revision change.
   - On every switch, replay regardless of prior runs to avoid stale in-memory state.

5) Tests
   - Regression: Workspace A with a non-main panel → add a new note in A → switch to B → switch back; expect panel present.
   - Repeat with rapid switches and multiple non-main panels.
   - Ensure datastore keys are isolated per workspace (no bleed).

6) Telemetry/Logging
   - Keep `panel_snapshot_skipped_no_owner` as a guardrail; add `workspace_snapshot_replay` with revision/workspace and panel counts.
   - Alert on unexpected owner-null during mutation or frequent snapshot replays with zero panels.

Rollout
- Behind `NOTE_WORKSPACES_V2` (and optional localStorage override) until stable.
- After validation, remove legacy canvas workspace persistence from the V2 path.
