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

Plan Overview (4 phases + quantitative guardrails)

1. **Infrastructure & APIs**
   - Extend `NoteWorkspace` runtime model to support multiple instances: each workspace needs its own `DataStore`, `LayerManager`, `EventBus`, and React subtree root (e.g., via `createPortal` into an offscreen container).
   - Introduce a `WorkspaceRuntimeRegistry` responsible for creating, caching, and disposing runtime instances. Existing hook (`useNoteWorkspaces`) will request the runtime for `currentWorkspaceId` instead of mutating a single global workspace.
   - Update `components/canvas/canvas-workspace-context.tsx` to expose a `getRuntime(workspaceId)` helper so descendant hooks (component creation handlers, etc.) can route events to the correct instance.
   - New component registration API: calculators, alarms, and future widgets must register/deregister themselves with the runtime registry via explicit calls (no implicit global singletons). Add assertions in dev mode to catch components that do not specify `workspaceId`.
   - Guard rails: runtime creation is behind `NOTE_WORKSPACES_LIVE_STATE` feature flag. When disabled, fallback to current single-canvas behavior.

2. **Keep inactive canvases alive**
   - Replace the “wipe and replay” switch flow with:
     1. Get/create runtime for destination workspace.
     2. Hide the current runtime (CSS visibility/offscreen) but do not dispose it.
     3. Show the destination runtime. The canvas never unmounts; only visibility toggles.
   - For non-visible runtimes, pause expensive renders (e.g., throttled RAF) but leave component state intact. Each runtime still listens for datastore/layer events.
   - Ensure auto-save/capture uses the runtime’s own data rather than a shared snapshot cache. This makes `captureCurrentWorkspaceSnapshot` read directly from the runtime belonging to `workspaceId`.
   - Update toolbars (floating toolbar, selection, etc.) to route commands (`openWorkspaceNote`, component creation) to the runtime for the target workspace (explicit workspaceId already plumbed).

3. **Lifecycle management & persistence**
   - Idle eviction: define a max live runtime count (configurable). When exceeding, serialize the least-recently-used workspace (capture snapshot, persist) and dispose its runtime to reclaim memory. Mark it as “cold” so the next switch rehydrates via snapshot as today.
     - Guardrail: start with `MAX_LIVE_WORKSPACES = 4` (desktop) / `2` (tablet). Add telemetry to record average runtime count, per-runtime memory estimates (approx via `performance.memory` or heuristics), and eviction frequency.
     - Resource targets: aim for < 250 MB incremental memory per additional runtime; if telemetry shows > 300 MB sustained, trigger earlier eviction or freeze.
   - Handle app reload: on boot, hydrate only the active workspace runtime; others are lazily created the first time the user switches to them.
   - Persistence changes:
     - Each runtime keeps its own dirty flag and schedule. `persistWorkspaceNow` iterates over dirty runtimes to save them in the background even if they are not visible.
     - `waitForPanelSnapshotReadiness` scopes to the runtime being saved to avoid cross-workspace blocking.
   - Telemetry:
     - `workspace_runtime_created`, `workspace_runtime_evicted`, `workspace_runtime_visible`, `workspace_runtime_hidden`.
     - `workspace_snapshot_replay` now includes `runtimeState: hot|cold`.

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
- **Memory usage spikes**: Mitigate with runtime cap + idle eviction + optional “background freeze” toggle that suspends inactive runtimes after X minutes.
- **Component code assuming single global store**: audit component creation APIs to ensure they always receive the target workspace runtime id; add assertions in dev mode.
- **Regression for legacy path**: keep legacy mode untouched; multi-runtime code executes only when both V2 + live-state flags are enabled.

Open Questions
- What is the acceptable maximum number of concurrent runtimes (desktop vs. tablet)? → Start with 4/2 target above; adjust after telemetry runbook.
- Do we need background throttling (e.g., `requestIdleCallback`) for long-running components (alarms)?
- Should we migrate calculators/alarms to Service Workers/Web Workers for better isolation? (Future exploration.)

Next Steps
1. Land runtime registry skeleton + feature flag.
2. Update `useNoteWorkspaces` and canvas providers to request per-workspace runtimes and enforce the new component-registration API.
3. Implement idle eviction + telemetry with resource targets.
4. Add test coverage, document go/no-go thresholds, and begin staged rollout.
