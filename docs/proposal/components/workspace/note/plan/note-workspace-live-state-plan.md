  # Note Workspace Live-State Isolation Plan

  Goal: make every workspace behave like a truly isolated browser tab — each workspace keeps its own canvas, data store, and component processes alive even when it is not the active view. Switching workspaces should only change which instance is visible; timers, calculators, alarms, and non-main panels continue running in the background until the user explicitly closes them.

  Applicability of isolation/reactivity anti-patterns: applicable. We must not introduce new provider/consumer drift or UI-only gating. All new context APIs require back-compat shims, and we cannot gate correctness at the toolbar.

  Scope
  - Note workspace runtime (canvas, datastore, layer manager, toolbar integration).
  - Workspaces V2 flag path only; legacy overlay workspaces remain untouched.
  - Browser-tab semantics for components: calculators, alarms, future plugins, and non-main panels.

  Out of scope
  - Redesign of annotation UI.
  - Collaborative/Yjs flows (unless explicitly called out later).

  Assumptions / Constraints
  - Memory budget: multiple live canvases will increase RAM usage. We must keep inactive canvases headless (no DOM rendering) and garbage-collect idle workspaces when a configurable ceiling is exceeded.
  - Only N workspaces (e.g., 4) may remain active simultaneously; beyond that, least-recently-used instances will be snapshotted and torn down.
  - Telemetry + tests must cover the new lifecycle before we enable it for all users.
  - Research inputs: “Note Workspace Live-State – Research Notebook” (docs/proposal/components/workspace/note/plan/Note Workspace Live-State – Research Notebook.pdf) documents the current single-runtime architecture, affected files, telemetry gaps, and profiling results. Every phase below cites those findings and continues to honor codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md (provider contracts over UI gating).

  Research Highlights (source files mirrored under docs/proposal/components/workspace/note/plan/research/live-state/):
  - `lib/hooks/annotation/use-note-workspaces.ts`: `collectPanelSnapshotsFromDataStore`, `waitForPanelSnapshotReadiness`, `captureCurrentWorkspaceSnapshot`, and `applyPanelSnapshots` all assume one global `DataStore`. Multi-runtime work must make each function accept a runtime reference so switches stop clearing unrelated panels.
  - Ownership truth currently lives in `workspaceOpenNotesRef` and `workspaceNoteMembershipRef`. The runtime registry must internalize these per workspace to eliminate provider drift.
  - UI actions (AnnotationAppShell → `canvas-workspace-context.tsx` → floating toolbar / `useWorkspaceNoteSelection`) already pass `workspaceId`; we’ll hook those entry points into the registry so every note/component action targets the right runtime.
  - Telemetry gaps: add `workspace_runtime_created|visible|hidden|evicted` plus `workspace_snapshot_replay` (`runtimeState`, `loadTimeMs`, `notesCount`, `panelsCount`, `componentsCount`) to validate hot vs. cold flows.
  - Resource constraints: profiling shows ~50–80 MB for idle runtimes and 120–150 MB for typical runtimes, so we enforce the ≤250 MB per-runtime budget and the 4/2 live-runtime cap with LRU eviction.

  Plan Overview (4 phases + quantitative guardrails)

  1. **Infrastructure & APIs**
    - Extend `NoteWorkspace` runtime model to support multiple instances: each workspace needs its own `DataStore`, `LayerManager`, `EventBus`, and React subtree root (e.g., via `createPortal` into an offscreen container).
    - Introduce a `WorkspaceRuntimeRegistry` responsible for creating, caching, serializing, and disposing runtime instances. `useNoteWorkspaces` requests `getRuntime(workspaceId)` instead of mutating a singleton, and the registry exposes helpers (e.g., `serialize`, `setOpenNotes`) surfaced by the research flow diagram.
    - Update `components/canvas/canvas-workspace-context.tsx` to expose registry lookups so descendant hooks (component creation handlers, floating toolbar, `useWorkspaceNoteSelection`) can route events to the correct instance without duplicating logic.
    - New component registration API: calculators, alarms, and future widgets must register/deregister themselves with the runtime registry via explicit calls (no implicit global singletons). Add assertions in dev mode to catch components that do not specify `workspaceId`.
    - Guard rails: runtime creation is behind `NOTE_WORKSPACES_LIVE_STATE` feature flag. When disabled, fallback to current single-canvas behavior.
    - Ownership plumbing: migrate `workspaceOpenNotesRef` / `workspaceNoteMembershipRef` from global refs to per-runtime truth sources. Provide migration helpers so `setNoteWorkspaceOwner`, deletion flows, and persistence routines read/write through the registry (addresses research Tasks 1–3).

  2. **Keep inactive canvases alive**
    - Replace the “wipe and replay” switch flow with:
      1. Get/create runtime for destination workspace.
      2. Hide the current runtime (CSS visibility/offscreen) but do not dispose it.
      3. Show the destination runtime. The canvas never unmounts; only visibility toggles.
    - For non-visible runtimes, pause expensive renders (e.g., throttled RAF) but leave component state intact. Each runtime still listens for datastore/layer events.
    - Ensure auto-save/capture uses the runtime’s own data rather than a shared snapshot cache. Refactor `collectPanelSnapshotsFromDataStore`, `waitForPanelSnapshotReadiness`, and `captureCurrentWorkspaceSnapshot` to accept runtime-scoped stores so switches stop clearing unrelated panels (the flicker root cause highlighted in the research).
    - Update toolbars (floating toolbar, selection, etc.) to route commands (`openWorkspaceNote`, component creation) to the runtime for the target workspace. AnnotationAppShell and `useWorkspaceNoteSelection` already pass `workspaceId`; we simply resolve a runtime before mutating note lists.
    - Telemetry: emit `workspace_runtime_visible` / `workspace_runtime_hidden` with `{ workspaceId, wasCold, runtimeCount }`, and extend `snapshot_capture_start` to include `runtimeState` for observability.

  3. **Lifecycle management & persistence**
    - Idle eviction: define a max live runtime count (configurable). When exceeding, serialize the least-recently-used workspace (capture snapshot, persist) and dispose its runtime to reclaim memory. Mark it as “cold” so the next switch rehydrates via snapshot as today.
      - Guardrail: start with `MAX_LIVE_WORKSPACES = 4` (desktop) / `2` (tablet). Add telemetry to record average runtime count, per-runtime memory estimates (approx via `performance.memory` or heuristics), and eviction frequency.
      - Resource targets: aim for < 250 MB incremental memory per additional runtime; if telemetry shows > 300 MB sustained, trigger earlier eviction or freeze.
    - Handle app reload: on boot, hydrate only the active workspace runtime; others are lazily created the first time the user switches to them.
    - Persistence changes:
      - Each runtime keeps its own dirty flag and schedule. `persistWorkspaceNow` iterates over dirty runtimes to save them in the background even if they are not visible.
      - `waitForPanelSnapshotReadiness` scopes to the runtime being saved, logging `snapshot_wait_pending_panels` for every capture attempt (no silent fallthroughs).
      - Runtime eviction pipeline: registry calls `serialize(workspaceId)` → persist snapshot/open notes → unmount runtime → mark workspace cold. Follow the deletion/reload checklist from the research notebook so deleted notes never resurrect on reload.
    - Telemetry:
      - `workspace_runtime_created`, `workspace_runtime_evicted`, `workspace_runtime_visible`, `workspace_runtime_hidden` (payload `{ workspaceId, wasCold, runtimeCount, reason }`).
      - `workspace_snapshot_replay` includes `runtimeState: hot|cold`, `loadTimeMs`, `notesCount`, `panelsCount`, `componentsCount` and fires only on cold loads/evictions.

  4. **Testing & rollout**
    - Unit:
      - Runtime registry: create/destroy/resume flows.
      - Idle eviction logic and snapshot persistence on eviction.
      - Hooks: verify `useNoteWorkspaces` routes commands to workspace-specific runtimes.
    - Integration/UI automation:
      - Scenario: open Default + Workspace B. Place calculator + alarm in both. Switch rapidly; ensure timers keep running (use fake timers/console logs from components).
      - Scenario: exceed runtime cap (e.g., open 5 workspaces). Verify LRU workspace is evicted and rehydrated on next switch without regressions.
    - Telemetry verification: logs show runtime events and no `panel_snapshot_apply_clear` entries on switches.
    - Launch steps & go/no-go criteria:
      1. Ship behind `NOTE_WORKSPACES_LIVE_STATE` (opt-in via query/localStorage).
      2. Internal dogfood.
      3. Gradual rollout with telemetry watchdogs:
          - `component_drop_rate` per workspace remains < 0.5% over rolling 1h.
          - Average runtime count ≤ configured cap; eviction success rate ≥ 99%.
          - Replay latency (runtime hot) < 50 ms median. If thresholds fail, auto-disable flag and revert to single-runtime mode.

  Risks & Mitigations
  - **Memory usage spikes**: Mitigate with runtime cap + idle eviction + optional “background freeze” toggle that suspends inactive runtimes after X minutes. Validate against the profiling numbers from the research notebook.
  - **Component code assuming single global store**: audit component creation APIs to ensure they always receive the target workspace runtime id; add assertions in dev mode.
  - **Regression for legacy path**: keep legacy mode untouched; multi-runtime code executes only when both V2 + live-state flags are enabled.
  - **Provider drift / ownership**: the research flagged global `openNotes` drift. Ensure ownership sync happens inside the registry and warn in dev mode if a component renders without a runtime match.
  - **Telemetry noise**: document how the new events relate to existing `workspace_select_clicked` / `snapshot_*` logs to avoid double-counting.

  Open Questions
  - What is the acceptable maximum number of concurrent runtimes (desktop vs. tablet)? → Start with 4/2 target above; adjust after telemetry runbook.
  - Do we need background throttling (e.g., `requestIdleCallback`) for long-running components (alarms)?
  - Should we migrate calculators/alarms to Service Workers/Web Workers for better isolation? (Future exploration.)

  Next Steps
 1. Land runtime registry skeleton + feature flag.
 2. Update `useNoteWorkspaces` and canvas providers to request per-workspace runtimes and enforce the new component-registration API.
 3. Implement idle eviction + telemetry with resource targets.
 4. Add test coverage, document go/no-go thresholds, and begin staged rollout.

> Phase 3 persistence work (`docs/proposal/components/workspace/note/plan/live-state-phase3-persistence.md`) tracks the remaining autosave/persist-by-id tasks mentioned above.
