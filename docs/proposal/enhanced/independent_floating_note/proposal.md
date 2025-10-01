# Floating Notes Independence Proposal

## Overview
- **Objective**: mirror proven industry patterns (Figma, Miro, Notion AI canvas) so floating notes stay functional and aligned whether or not a canvas is mounted.
- **Current state**: `FloatingNotesWidget` renders outside the canvas DOM, yet `NotesExplorerPhase1` relies on canvas-sourced transforms, layer shortcuts, and popup hosts. Popup state is persisted in canvas coordinates, so removing the canvas breaks positioning and interactions.
- **Desired outcome**: treat floating notes as a canvas-agnostic surface with its own overlay service, capability-aware APIs, and screen-space persistence that optionally upgrades to canvas precision when available.

## Existing Coupling
1. **Layer context dependency**
   - `NotesExplorerPhase1` calls `useLayer()` for transforms, shortcuts, and layer toggles (`components/notes-explorer-phase1.tsx`).
   - Popup positioning converts `canvasPosition` via `CoordinateBridge` (`components/notes-explorer-phase1.tsx`).
2. **Overlay adapter binding**
   - `OverlayLayoutAdapter` assumes canvas workspace keys and persistence stores.
3. **Popup overlay portal**
   - `PopupOverlay` prefers `#canvas-container` but only recently added a `document.body` fallback (`components/canvas/popup-overlay.tsx`).
4. **Mouse and selection semantics**
   - Focus management and multi-select behavior defer to canvas layer state, which is missing when the canvas is absent.

These ties mean the host-sync patch protects against missing DOM nodes but does not deliver functional independence.

## Adoption Strategy (Industry Pattern)
- Feature flags are not part of this rollout; sequencing and testing act as the safety net.

Successful products separate three responsibilities: data persistence, transform sourcing, and optional canvas affordances. We will adopt the same separation.

### Phase 1 – Stabilize Overlay Host Controller (Complete / In Progress)
- Keep the fallback overlay host so portals always have a mount point.
- Continue watching for canvas host mount/unmount to rebind automatically.

### Phase 2 – Screen-Space Persistence Layer
- Introduce a screen-space data model for popups (`overlayPosition`) stored independently from canvas transforms.
- On canvas attach, derive canvas-space coordinates lazily via adapters; persist both when available.
- Provide reconciliation logic to keep screen- and canvas-space values in sync without requiring the canvas to exist.

### Phase 3 – Neutral Overlay Service & Capability Contracts
- Create a `FloatingOverlayController` that exposes:
  - `getTransformStream()`: delivers screen-space transforms with optional canvas precision when an adapter is registered.
  - `registerPopups()` / `updatePopupPosition()` working in screen-space, auto-upgrading if canvas data is present.
  - Capability introspection (e.g., `{ shortcuts: boolean, layerToggle: boolean, persistence: boolean }`).
- Host the controller in `lib/overlay/` with a context provider consumed by both the widget and canvas.

### Phase 4 – Canvas & Non-Canvas Adapters
- Implement `CanvasOverlayAdapter` that wires LayerProvider transforms, shortcuts, and persistence into the controller.
- Implement `IdentityOverlayAdapter` (screen-space only) for non-canvas contexts.
- Teach `NotesExplorerPhase1` to:
  - Read capability flags and disable/replace layer shortcuts when unsupported.
  - Prefer controller hooks over direct `useLayer()` usage.

### Phase 5 – Popup Overlay Refactor
- Update `PopupOverlay` to consume the controller’s transform stream and DOM-host setting instead of interrogating the canvas directly.
- Allow explicit host overrides so popups can render inside a widget-owned container when needed.
- Ensure screen-space positions remain valid when the canvas remounts by applying adapter-provided transforms.

### Phase 6 – Migration & Hardening
- Add runtime warnings when the widget runs without a registered adapter yet attempts canvas-only features.
- Write integration tests for:
  - Widget opening before canvas mount.
  - Canvas hot reload during active popups.
  - Non-canvas routes using the identity adapter.
- Remove direct imports from `components/canvas/` within floating notes code paths.

## Deliverables
### Persistence Migration Plan
- Increment schema to v2 with parallel fields: existing `canvasPosition` remains, new `overlayPosition` stores screen-space coordinates.
- Update API envelopes to accept/return both sets; legacy clients ignore `overlayPosition`, controller backfills missing values using current transforms.
- Provide a one-time migration job that reads stored layouts, computes `overlayPosition` from canvas data, and writes v2 entries without losing revision history.

### Layer Capability Matrix
- Document each LayerProvider affordance and its controller mapping:
  - Transforms → `getTransformStream()` (always available).
  - Active layer toggles → optional `setActiveLayer` capability; disabled when adapter lacks multi-layer support.
  - Keyboard shortcuts → controller exposes `registerShortcutHandlers()` only when adapter opts in.
  - Sidebar/open state → optional `toggleSidebar` capability; widget hides controls otherwise.
  - View reset/pan → `resetView` capability; fall back to widget-local recentre when absent.
- Maintain this matrix in `lib/overlay/README.md` so implementers know required vs optional hooks.

- `lib/overlay/floating-overlay-controller.ts`: core controller and capability API.
- `components/overlay/floating-overlay-provider.tsx`: context provider exposing controller hooks.
- `lib/overlay/adapters/canvas-overlay-adapter.ts`: bridges existing LayerProvider data.
- `lib/overlay/adapters/identity-overlay-adapter.ts`: screen-space implementation.
- Refactors to `components/notes-explorer-phase1.tsx` and `components/canvas/popup-overlay.tsx` to use controller hooks and capability flags.
- Schema migration or persistence update (if needed) to store screen-space `overlayPosition`.

## Risks & Mitigations
- **Transform drift without canvas**: screen-space persistence may diverge once a canvas attaches.
  - Mitigation: reconcile using adapter-provided transforms and log when drift exceeds tolerance.
- **Feature gaps outside canvas**: keyboard shortcuts and layer toggles lose meaning.
  - Mitigation: rely on controller capabilities; disable shortcuts and expose widget-local affordances when unsupported.
- **Persistence complexity**: dual storage (screen + canvas space) introduces sync bugs.
  - Mitigation: centralize conversions in controller, cover with unit tests.

## Validation Strategy
- Unit-test controller adapters for coordinate conversions and capability reporting.
- Add Playwright coverage for screen-space fallback scenarios.
- Manual regression: verify popups stay aligned through canvas mount/unmount, browser resize, zoom, and hot reload.

## Open Questions
- Should we support multiple overlay surfaces simultaneously (e.g., whiteboard + notes) via multi-adapter registration?
- How should screen-space persistence interact with collaborative sessions (conflict resolution when two adapters provide different transforms)?

