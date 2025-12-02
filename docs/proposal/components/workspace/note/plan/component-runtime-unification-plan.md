# Component Runtime Unification Plan

## Goal

Treat non-note components (calculator, timer, alarm, etc.) the same as notes by keeping their runtime state in `WorkspaceRuntime`, letting LayerManager act purely as a rendering helper. This removes the need for hot-runtime restore hacks and ensures components persist across switches/evictions just like notes do.

## Phase 1 – Runtime Ledger & Registry API

1. **Extend `WorkspaceRuntime`** (`lib/workspace/runtime-manager.ts`)
   - Add a `components` map keyed by `componentId` storing `RuntimeComponent` entries `{ componentId, componentType, workspaceId, position, size, metadata, zIndex, lastSeenAt }`.
   - Implement helpers: `registerRuntimeComponent`, `updateRuntimeComponent`, `removeRuntimeComponent`, `listRuntimeComponents`, `getRuntimeComponent`.

2. **Update registration hook** (`lib/hooks/use-component-registration.ts`)
   - On mount: call `registerRuntimeComponent(workspaceId, initialSnapshot)` and LayerManager registration.
   - On updates (position/metadata changes) call `updateRuntimeComponent`.
   - On unmount: *do not delete* runtime entry; mark `lastSeenAt` or keep data so runtime state persists even when React unmounts.
   - Continue LayerManager registration for rendering but treat it as secondary.

## Phase 2 – Build/Replay Pipeline Changes

1. **`buildPayload` uses runtime ledger**
   - Replace component collection logic with `listRuntimeComponents(workspaceId)` so persisted payload mirrors runtime ledger.
   - Still attach LayerManager-derived z-index/position when available, but runtime entry is authoritative.

2. **Hydration/replay populates runtime ledger**
   - During `hydrateWorkspace`/`previewWorkspaceFromSnapshot`, insert components into `WorkspaceRuntime.components` before rendering.
   - Introduce `syncLayerManagerFromRuntime(workspaceId)` that reads runtime components and ensures LayerManager nodes exist.
   - Remove Fix 5/6 fallback code once runtime ledger drives rendering.

## Phase 3 – Rendering Hooks & Canvas Items

1. **Canvas note sync** (`useCanvasNoteSync`) reads runtime components via a new hook (e.g., `useRuntimeComponents(workspaceId)`) and injects them into `canvasItems` alongside notes.
2. **Component modules** (calculator/timer) fetch their initial state (position, metadata) from the runtime ledger so they render correctly even before LayerManager updates.

## Phase 4 – Cleanup & Compatibility

1. Remove legacy hot-runtime component restore paths since runtime ledger now preserves state.
2. Add dev-mode telemetry/warnings if a component renders without a ledger entry, to catch wiring regressions early.
3. Keep the new system behind a short-lived flag (`NOTE_WORKSPACES_COMPONENT_LEDGER`) until validated, then remove old behavior.

## Validation & Rollout

- **Unit tests**: runtime ledger helpers, payload serialization/deserialization, eviction persistence.
- **Integration tests**: create calculator/timer + note, switch/evict/reload, ensure state persists without restoration hacks.
- **Telemetry**: monitor `save_success` component counts, `runtime_component_registered` events, eviction logs.

Once this plan is implemented, notes and other components will share the same runtime lifecycle—no more manual restores or discrepancies between LayerManager and persisted payloads.
