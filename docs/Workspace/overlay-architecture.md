# Overlay Workspace Architecture

## Overview
The popup overlay grants each workspace its own saved layout (popups, positions, inspectors) while sharing a single tree
of Knowledge Base folders. Popups reference folder IDs stored in the `items` table, and hydration loads both the layout
and the folder data when a workspace is activated. The 2025 “overlay infinite canvas” update removes clipping around the
sidebar so popups stay visible no matter how far the user pans, aligning overlay behavior with the note canvas. A new
overlay minimap (rehydrating the constellation minimap stack) provides spatial awareness across the infinite plane and
lets users reorient or jump via a miniature camera overlay.

## Key Concepts
- **Overlay Layout (per workspace)**: Stored in `overlay_layouts`. Each layout references `folderId`s that point to rows
  in `items`. Workspace switching only swaps overlay geometry; the underlying folders remain shared.
- **Knowledge Base (Global)**: The Organization sidebar is a Knowledge Base browser. It always reflects the global tree,
  regardless of the active workspace. Layout hydration never mutates or filters the sidebar tree.
- **Workspace Scoping**: Overlay API calls send `X-Overlay-Workspace-ID` so server routes know which layout to load or
  persist. Folder fetches for the sidebar remain unscoped so cache keys stay stable per `folderId`.
- **Infinite Canvas Overlay**: `PopupOverlay` now spans the full canvas rectangle (no `clipPath` inset). Popups can be
  dragged beneath/behind the sidebar or far off the initial viewport and remain renderable, with pointer guards keeping
  the sidebar interactive.
- **Floating Toolbar Org Button**: The floating toolbar includes an `Org` button that toggles the Organization panel. That
  panel lists the Knowledge Base children (e.g., My Document, Todo), mirroring the global tree. Hovering a folder’s “eye”
  icon previews the registered popups, and clicking the icon restores those popups onto the overlay canvas for the active
  workspace.
- **Overlay Minimap**: A lightweight, always-on (but flag-gated) minimap mirrors popup positions and the viewport
  rectangle using existing camera transforms. It reuses constellation minimap rendering primitives so it stays performant
  on large layouts and can recenter the workspace when users drag inside the miniature.

## Architecture Rules
1. **Popup folder IDs must be valid**: Each popup descriptor must point to an existing Knowledge Base folder. Hydration
   repairs or skips legacy references without crashing the workspace.
2. **Sidebar is global**: Switching workspaces never clears or replaces the sidebar tree; it continues to mirror the
   Knowledge Base and stays responsive even when popups pass underneath it.
3. **Workspace layouts are independent**: Dragging or saving popups mutates only the current workspace layout stored in
   `overlay_layouts`. Folder data stays global and cached per `folderId`.
4. **Workspace context only at layout time**: The active workspace ID is applied when popups are saved/restored. Folder
   content still loads via unscoped `/api/items` endpoints and is reused across workspaces.
5. **Infinite canvas guardrails**: Overlay math cannot shrink around the sidebar. Pointer hit-testing enforces sidebar
   interactivity, and visibility checks operate on the expanded virtual viewport so popups with negative coordinates stay
   visible. Connection lines render even when their endpoints temporarily leave the screen.
6. **Instrumentation discipline**: Drag logging is throttled (250 ms guard) so enabling `NEXT_PUBLIC_DEBUG_LOGGING=true`
   no longer floods `/api/debug/log`. Pointer-level logs stay opt-in.
7. **Minimap remains observational**: The minimap reads existing popup maps and camera transforms without changing
   persistence formats. Gesture-to-camera updates route through the same `setTransform` helpers the overlay already uses.

## Infinite Canvas Behavior Details
- **Container bounds**: `recomputeOverlayBounds` uses the full `canvasRect` (plus generous margins) instead of subtracting
  the sidebar overlap. The wrapper relies on standard overflow handling rather than `clipPath`.
- **Pointer guard**: `handlePointerDown` first checks if the event target lies inside the sidebar’s bounding box; if so it
  aborts drag/pan logic so the sidebar can scroll/select without interference.
- **Visibility calculations**: `visiblePopups` tests against the virtual canvas, allowing negative coordinates or far
  offsets. Connection-line rendering is uncoupled from popup visibility so links stay visible while panning.
- **Debug log throttling**: Pointer-move logs respect both `NEXT_PUBLIC_DEBUG_LOGGING` and a dedicated drag-trace flag,
  only emitting at most four times per second. This keeps terminals quiet while still allowing targeted diagnostics.
- **Feature flag**: The entire behavior is gated by `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` (default `true`). Toggling it off
  reverts to the legacy clipped overlay for rollback.

## Overlay Minimap Behavior Details
- **Data adapter**: `useOverlayMinimapData` (planned) will adapt `Map<string, PopupData>` plus the current transform into
  node definitions reused from the constellation minimap (id, position, optional depth). This hook memoizes results so
  minimap renders only when popups or transforms change.
- **Rendering**: The minimap lives in the overlay layer (typically bottom-right) and reuses SVG primitives to draw nodes,
  parent-child links, and the active viewport rectangle. It respects global Knowledge Base data—nodes remain identical no
  matter which workspace is active—and never blocks popup interactions.
- **Gestures**: Clicking or dragging inside the minimap converts movement into overlay camera deltas via
  `layerCtx.updateTransformByDelta`. A debounced pipeline (borrowed from constellation) ensures smooth sync without
  thrashing React renders.
- **Performance guards**: Rendering pauses when there are no popups; clustering stays optional but available for dense
  layouts. Debug logging stays tied to the existing drag-trace flag so the minimap does not add per-frame `/api/debug/log`
  calls.
- **Feature flag / rollback**: `NEXT_PUBLIC_OVERLAY_MINIMAP` (default `false` until the rollout completes) enables the UI.
  Turning it off hides the minimap without altering workspace layouts or transforms.

## Workflow Summary
1. User selects a workspace via the toggle (Workspace 1, Workspace 2, etc.).
2. The overlay loads the saved layout for that workspace from `overlay_layouts`, applying the infinite canvas bounds if
   `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN=true`.
3. The Knowledge Base sidebar remains unchanged—it still shows the global tree and captures pointer events inside its
   bounding box.
4. Users can either click a sidebar folder or use the floating toolbar’s `Org` button to open the Organization panel,
   hover a folder’s “eye” icon to preview its popups, and click the icon to restore those popups inside the current
   workspace layout. Panning can then move them anywhere on the virtual canvas without clipping.

## Feature Flags & Compliance
- `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` controls whether the full-span overlay is active. Set to `false` during incidents
  to restore the legacy clipped behavior.
- `NEXT_PUBLIC_OVERLAY_MINIMAP` controls whether the minimap mounts. Keep it `false` until QA completes; flip it back to
  disable the minimap without touching saved layouts.
- Changes honor `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`: no new context contracts or hooks
  were introduced; minimap reads the same context snapshots that existing overlay components already consume.

## Future Enhancements
- **Parity Seeding**: Optionally clone the baseline Knowledge Base folders into each workspace to keep layouts and data
  perfectly aligned.
- **Click-time Repair**: Offer users a “Clone into current workspace” action if a popup references an out-of-scope folder.
- **Minimap Toggles**: Provide a user-facing toggle or gesture to collapse the minimap, plus optional clustering controls
  borrowed from the constellation path once the rollout stabilizes.
