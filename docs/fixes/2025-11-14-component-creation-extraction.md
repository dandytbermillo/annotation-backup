# Component Creation Extraction Plan

## Context
- `components/annotation-canvas-modern.tsx` still contains the full `handleAddComponent` implementation and the sticky/floating component wiring (roughly lines 840–920).
- Unlike panels, component creation still mixes viewport math, screen→world conversions, default positioning, and state updates directly inside the component.
- Earlier refactors (hydration, snapshot, panel creation) show the pattern: move heavyweight logic into hooks for isolation and testability.

## Why Extract This Block
1. **Readability** – ModernAnnotationCanvas continues shrinking as we peel off large handlers; component creation is now the biggest remaining inline chunk.
2. **Testability** – A hook (e.g., `useComponentCreationHandler`) would let us unit-test screen→world conversions, default positioning, and sticky vs floating behavior identical to the panel-creation tests we just added.
3. **Consistency** – Aligns with the pattern used for `usePanelCreationHandler`, `usePanelCreationEvents`, and other hooks, keeping the component focused on wiring.

## Proposed Steps
1. Extract `handleAddComponent` + supporting state into a hook under `lib/hooks/annotation/`.
   - Inputs: `canvasState`, `setCanvasItems`, optional `position`, etc.
   - Outputs: handler functions for adding/closing/updating component positions.
2. Port the sticky/floating memoized lists and overlay wiring to use the hook’s API.
3. Add targeted tests to cover:
   - Default world positioning relative to viewport center.
   - Sticky-note preview path vs standard component path.
   - Position updates/closures adjusting `canvasItems`.
4. Follow-up: consider extracting `handleRestoreMainPosition` or sticky overlay wiring once component creation is isolated.

This keeps ModernAnnotationCanvas focused on compositional wiring and brings component creation under the same testable surface area as the other refactored blocs.
