# Note Workspace Live Runtime Implementation Plan

Goal: make each Note Workspace behave like its own running “tab” so non-main panels and components never tear down during switches. Workspaces should capture their full state atomically and keep optional live instances that continue processing off-screen.

## 1. Architecture Overview
- **Per-workspace runtime:** Instantiate a `WorkspaceRuntime` object (datastore + LayerManager + timers) per workspace ID. Runtimes own all panels/components for their workspace; the global canvas only mounts the active runtime.
- **Authoritative ownership map:** `setNoteWorkspaceOwner` becomes a first-class API of the runtime manager. Every panel/component creation registers against the runtime before persistence.
- **Live instance pool:** Keep the active workspace mounted plus up to `N` background runtimes (configurable flag). When a workspace exceeds the pool, evict the least-recently-used runtime after serializing it.
- **Atomic snapshots:** Capture/restore runs at the workspace level. A snapshot includes camera, open notes order, panels, components, timers, and metadata in a single payload.

## 2. Deliverables & Milestones
1. **Runtime Manager Foundations**
   - Files: `lib/workspace/runtime-manager.ts`, `components/canvas/canvas-workspace-context.tsx`.
   - Create a `WorkspaceRuntime` class wrapping `DataStore`, `LayerManager`, pending queues, and event bus.
   - Add `WorkspaceRuntimeManager` with `getOrCreate(workspaceId)` / `destroy(workspaceId)` plus ownership bookkeeping.
2. **Canvas Integration**
   - Files: `components/annotation-canvas-modern.tsx`, `components/workspace/annotation-workspace-canvas.tsx`.
   - Refactor the canvas to consume `workspaceRuntime` instead of the shared `useCanvas()` store.
   - Expose `runtime.render()` and `runtime.pause()` so background workspaces stay alive without DOM nodes.
3. **Atomic Snapshot Pipeline**
   - Files: `lib/hooks/annotation/use-note-workspaces.ts`, `lib/note-workspaces/state.ts`, `lib/workspace/runtime-manager.ts`.
   - Implement `WorkspaceSnapshot` that aggregates panels/components/camera/openNotes in one payload.
   - `captureWorkspaceSnapshot(runtimeId)` waits for `runtime.pendingCount === 0` and serializes the runtime in a single transact.
   - `applyWorkspaceSnapshot(runtimeId, snapshot)` hydrates the runtime before the UI mounts it.
4. **Live-State Toggle & Pool**
   - Files: `components/annotation-app-shell.tsx`, `components/canvas/canvas-workspace-context.tsx`.
   - Feature flag: `NOTE_WORKSPACES_LIVE_STATE`.
   - Maintain an LRU pool of live runtimes (default 2). Exceeding the pool serializes & evicts the least-recent workspace.
   - UI provides a toggle per workspace (“Keep alive”) that pins it in the pool.
5. **Telemetry & Safeguards**
   - Files: `lib/note-workspaces/state.ts`, `logs/debug`.
   - Emit `runtime_started`, `runtime_evicted`, `snapshot_capture_blocked`, `snapshot_replay_complete`.
   - Add health checks: watchdog ensures pending queues drain; emit warnings if captures exceed timeout.

## 3. Detailed Steps
### Step 1: Runtime Manager Foundations
1.1 Create `lib/workspace/runtime-manager.ts`.
   ```ts
   class WorkspaceRuntime {
     id: string
     dataStore: DataStore
     layerManager: LayerManager
     pendingPanels: Map<string, PendingEntry>
     pendingComponents: Map<string, PendingEntry>
     status: "running" | "paused"
     serialize(): WorkspaceSnapshotPayload
     hydrate(payload: WorkspaceSnapshotPayload): void
     pause(): void
     resume(): void
   }
   ```
1.2 Update `CanvasWorkspaceProviderV2` to request runtimes from the manager instead of `getWorkspaceStore`. Provide `openNote` / `closeNote` hooks that call `runtimeManager.setOwner(noteId, workspaceId)`.
1.3 Ensure ownership updates (`setNoteWorkspaceOwner`, `clearNoteWorkspaceOwner`) delegate to the runtime manager to avoid divergence.

### Step 2: Canvas Integration
2.1 In `AnnotationWorkspaceCanvas`, obtain the active runtime via context and pass runtime references to `AnnotationCanvas`.
2.2 Replace direct usage of global `useCanvas()` store with runtime-provided versions (e.g., `runtime.dataStore`, `runtime.layerManager`).
2.3 Create `useRuntimeMount` hook that mounts the runtime’s React subtree when active and pauses it when not.

### Step 3: Atomic Snapshot Pipeline
3.1 Introduce `WorkspaceSnapshotPayload` with fields `{runtimeId, openNotes, panels, components, camera, metadata, version}`.
3.2 Rewrite `captureCurrentWorkspaceSnapshot` to call `runtime.serialize()` after awaiting `runtime.waitForSettled(maxMs)`. If pending queues don’t drain, emit `snapshot_capture_blocked`.
3.3 Update `applyPanelSnapshots` & related helpers to operate on the runtime’s datastore directly; remove per-note replay loops.
3.4 Ensure `useCanvasSnapshot` becomes a thin adapter that only handles localStorage fallback; the runtime is responsible for the authoritative state.

### Step 4: Live-State Pool
4.1 Add runtime pool settings under `lib/config/workspace-live-state.ts` (e.g., `MAX_LIVE_WORKSPACES`, `EVICTION_STRATEGY`).
4.2 When switching workspaces:
   - If target runtime exists and is paused, resume it and attach to the canvas.
   - If not, hydrate from the last snapshot, mark as running, and add to pool.
   - If pool exceeds limit, pick an evictable runtime (not pinned, not current), pause it, serialize snapshot, emit `runtime_evicted`.
4.3 Extend the workspace menu with a “Keep alive” toggle that pins/unpins runtimes. Persist pinning preference per workspace.

### Step 5: Telemetry, Tests, Docs
5.1 Logging:
   - `runtime_started`, `runtime_resumed`, `runtime_paused`, `runtime_evicted`.
   - `snapshot_capture_start`, `snapshot_capture_complete`, `snapshot_capture_blocked`.
   - `snapshot_replay_start`, `snapshot_replay_complete`.
5.2 Testing:
   - Unit tests for `WorkspaceRuntime` (serialize/hydrate, pending tracking).
   - Jest tests for `workspace-live-state` pool eviction.
   - Integration test scenario: add non-main panel + component; switch rapidly; assert they remain mounted.
5.3 Documentation:
   - Update `docs/proposal/components/workspace/note/plan/note-workspace-overlay-parity-fix.md` to reference the new live runtime architecture.
   - Add migration notes for legacy code paths (shared workspace fallback).

## 4. Rollout Strategy
1. **Phase 1 (Behind Flag):** Ship runtime manager and atomic snapshots under `NOTE_WORKSPACES_RUNTIME_V2`. Keep current behavior as fallback.
2. **Phase 2 (Enable on Dev):** Enable flag in dev/staging, monitor telemetry (`runtime_evicted`, pending stats) to ensure captures settle before replay.
3. **Phase 3 (Live-State Toggle):** Introduce UI “Keep alive” option; default off while pool stability is validated.
4. **Phase 4 (Default On):** Once stable, enable runtime architecture by default, keep legacy snapshot path only as a fallback flag.

## 5. Dependencies & Risks
- Requires stable workspace IDs and reliable ownership signals (fixes from overlay parity plan must stay).
- Memory footprint: keeping multiple runtimes alive increases memory usage. Need clear eviction + diagnostics.
- Persistence compatibility: ensure atomic snapshot payload stays backward-compatible or includes versioning.

## 6. Success Metrics
- No `panel_snapshot_apply_clear` events when switching workspaces.
- `snapshot_capture_start` always paired with `pendingCount>0` when new panels/components exist.
- User repro (“create note + components → switch rapidly → add second note”) shows zero flicker for non-main panels/components.
- Telemetry shows reduced `snapshot_pending_timeout` and zero “Unknown component type” replays.
