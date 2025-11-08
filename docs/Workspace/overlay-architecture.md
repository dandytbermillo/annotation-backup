# Overlay Workspace Architecture

## Overview
The popup overlay gives every workspace its own saved layout (popups, inspectors, camera transform) while the Knowledge
Base sidebar stays global. Popups reference folder IDs stored in the shared `items` table, so switching workspaces only
re-hydrates overlay geometry; the underlying folders and notes never fork. The 2025 infinite-canvas upgrade removes the
sidebar clip, adds per-workspace camera persistence, and introduces a minimap (flag-gated) that reuses the constellation
stack for spatial awareness. Lazy hydration keeps overlay costs at zero until a user explicitly opts into the layer,
which also prevents overlay fetches from racing plain-mode autosave.

## System Concepts & Guardrails
- **Workspace layouts vs. global data**: Layout JSON lives in `overlay_layouts` per workspace, but popups still point to
  globally shared folders/notes in `items`. Hydration never mutates the sidebar tree.
- **Scoped persistence**: Overlay API calls send `X-Overlay-Workspace-ID`, and adapters pass the active ID into
  `/api/overlay/layout/:workspaceId` and `/api/overlay/workspaces`. Folder fetches remain unscoped so cache keys stay
  stable per `folderId`.
- **Lazy hydration + autosave safety**: `shouldLoadOverlay` flips only when the user toggles the overlay layer, opens
  the floating toolbar Org panel, hovers a sidebar eye icon, or opens the workspace switcher. Pending plain-mode note
  snapshots wait for providers to warm before calling `saveDocument`, avoiding `baseVersion 0` conflicts while overlay
  hydration spins up.
- **Camera persistence & optimistic hydration**: Each layout stores `camera { x, y, scale }`. `LayerProvider` reapplies
  the saved transform only if the user has not moved since hydration started; otherwise it preserves the live transform
  and marks the layout dirty so the next save captures the user’s position.
- **Infinite canvas guardrails**: `PopupOverlay` spans the full canvas rectangle (no `clipPath` inset). Pointer guards
  keep the sidebar interactive, and visibility checks operate on the expanded viewport so popups with negative coords
  remain renderable. Drag logging is throttled to avoid `/api/debug/log` floods.
- **Shared preview/hover channel**: Both the floating toolbar Org list and the sidebar rely on `useNotePreviewHover`
  (single debounce, shared lifecycle) so hover previews and sidebar hover popups stay in sync.
- **Move cascade & pinning**: Popup headers expose a cascade toggle that links descendants for lock-step moves. Children
  can opt out via “Pin to Stay,” and turning the toggle off clears highlights immediately.
- **Minimap stays observational**: The minimap (behind `NEXT_PUBLIC_OVERLAY_MINIMAP`) reads the same popup map and camera
  transform that `PopupOverlay` already owns. It never persists data on its own and routes gesture updates through the
  standard `LayerProvider` helpers.
- **Diagnostics never crash layouts**: Hydration collects `resolvedFolders`, `missingFolders`, and workspace mismatch
  diagnostics. Popups referencing unknown folders stay renderable with cached metadata while errors surface in
  observability.

## Data Model & Persistence

### Tables & Entities
- **`workspaces`**: Directory of user-visible overlay workspaces. The default workspace is cached via `WorkspaceStore`
  and reused in API routes so RLS/trigger logic can rely on `app.current_workspace_id`.
- **`overlay_layouts`**: Stores workspace-specific layout envelopes. Each row contains `{ workspace_id, user_id, layout,
  version, revision, updated_at }`. `layout` is normalized JSON (schema version `2.2.0`) capped at `MAX_LAYOUT_BYTES`
  (128 KB).
- **`items` / Knowledge Base**: Holds folders/notes referenced by popups. Hydration joins into `items` to resolve names,
  colors, ancestry, and children so the overlay can render badges and previews without extra fetches.

### Overlay Layout Payload
- **`schemaVersion`**: Matches `OVERLAY_LAYOUT_SCHEMA_VERSION`. The API rejects mismatches between the envelope version
  and `layout.schemaVersion`.
- **`popups: OverlayPopupDescriptor[]`**: Each descriptor stores `id`, `folderId`, `parentId`, `canvasPosition`, optional
  `overlayPosition`, `level`, `width`, `height`, and cached folder metadata. `ensureOverlayPositions` backfills
  `overlayPosition` from `canvasPosition` so legacy saves remain valid.
- **`inspectors`**: Array of inspector panes (`type`, `visible`, optional `pane`) so each workspace restores its tool
  drawers.
- **`camera`**: `{ x, y, scale }`, persisted and defaulted to `{0,0,1}` when absent. Saves fire whenever the user stops
  panning/zooming, ensuring camera-only changes trigger persistence.
- **`resolvedFolders`** *(optional)*: Map of popup ID → resolved folder metadata (color, ancestors, children, workspace).
  Populated server-side via `buildEnvelopeWithMetadata`.
- **`diagnostics`** *(optional)*: Arrays describing missing folder references or workspace mismatches. Consumers treat
  them as hints; rendering never blocks on diagnostics.
- **`lastSavedAt`**: Timestamp captured server-side when normalization runs with `useServerTimestamp=true`.

### Diagnostics, Conflicts & Normalization
- `normalizeLayout` sanitizes incoming JSON (drops invalid popups/inspectors, coerces timestamps, bounds camera values).
- `OverlayLayoutAdapter.saveLayout` enriches payloads, enforces `MAX_LAYOUT_BYTES`, and throws `OverlayLayoutConflictError`
  on 409 responses. When `NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS=true`, conflict metadata is logged via `debugLog`.
- Conflict responses include the latest envelope so clients can merge before retrying.
- `buildEnvelopeWithMetadata` populates `resolvedFolders` and diagnostics by querying `items` (with ancestry limited to 10
  hops for color lookup). Failures yield an envelope without resolved data rather than erroring.

## Client Architecture

### Intent-gated entry (`AnnotationAppContent`)
- `shouldLoadOverlay` starts at `false`. Toggling the overlay layer, interacting with the floating toolbar Org/View
  actions, hovering a sidebar eye icon, or opening the workspace picker flips it to `true`.
- Until the gate opens, overlay effects (`OverlayLayoutAdapter` instantiation, layout saves, hover popups, minimap) all
  short-circuit. This keeps note-only sessions lightweight and removes races with plain-mode autosave.
- Once the gate opens, the component spins up the adapter, resumes overlay-specific effects, and hydrates the current
  workspace layout exactly once per activation.

### LayerProvider & Camera Lifecycle
- `LayerProvider` tracks transforms for `popups`, `notes`, and other layers. Overlay code keeps `latestCameraRef` synced
  with transform changes and remembers when the user last dragged.
- Hydration is optimistic: if `overlay_layout_hydrate_start` fires and the user drags before the layout arrives,
  `applyOverlayLayout` skips reapplying the database camera to avoid snapping the view back. It still updates
  `latestCameraRef` so the next save writes the user’s transform.
- Camera persistence uses the same dirty/timer path as popup drags, so a pan/zoom without popup changes still persists.

### PopupOverlay & Input Model
- `PopupOverlay` mounts only after hydration starts. It spans the full canvas rectangle when
  `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN=true`, keeping popups visible even beneath the sidebar.
- Pointer guards check whether the event target intersects the sidebar bounds before starting drags so the sidebar stays
  interactive.
- Drag logging honors `NEXT_PUBLIC_DEBUG_LOGGING` + `NEXT_PUBLIC_DEBUG_POPUP_DRAG_TRACE` and throttles to 4 logs/sec.
- Move cascade state lives in overlay context: enabling the hand toggle links descendants, highlights the subtree, and
  applies pan deltas to all unpinned members. Layout saves capture both popup coordinates and the current camera.

### Floating Toolbar, Sidebar & Hover Previews
- The floating toolbar exposes an `Org` button that mirrors the global Knowledge Base tree. Hovering folder/note “eye”
  icons routes through `useNotePreviewHover`, which drives both toolbar previews and sidebar hover popups (shared debounce
  and `/api/items` fetch lifecycle).
- Clicking a folder eye restores the registered popups for the active workspace. Clicking a note eye opens the shared
  preview tooltip; clicking again can promote it into an overlay popup.
- All overlay API requests include `X-Overlay-Workspace-ID` so backend routes persist the correct layout even while the
  sidebar continues to fetch unscoped Knowledge Base data.

### Overlay Minimap (Flag-Gated)
- `NEXT_PUBLIC_OVERLAY_MINIMAP` controls mounting. When enabled, a small minimap renders in the overlay layer (typically
  bottom-right) and mirrors popup positions + the viewport rectangle using the same transform data as `PopupOverlay`.
- A dedicated hook (planned as `useOverlayMinimapData`) adapts the `Map<string, PopupData>` and camera transform into the
  node/viewport structures the constellation minimap already understands. Memoization keeps renders cheap.
- Gestures (click/drag inside the minimap) translate to `layerCtx.updateTransformByDelta`, so the main canvas remains the
  single source of truth for movement.

### Autosave & Plain-Mode Guard
- Pending plain-mode note snapshots promoted from `localStorage` wait for the offline provider cache to finish loading
  before calling `saveDocument`. If the provider isn’t ready, the promotion logs a warning and aborts. This prevents
  `baseVersion 0 behind latest N` errors when overlay hydration and autosave overlap.
- Overlay hydration respects this guard by deferring any workspace fetches until the user signals intent, reducing the
  chance of simultaneous provider work.

## Activation & Hydration Flow
1. **Intent detected** - Any overlay entry point flips `shouldLoadOverlay` to `true`. Before that, overlay UI remains
   dormant and LayerProvider ignores popups transforms.
2. **Adapter preparation** - `OverlayLayoutAdapter` is instantiated with the active workspace ID and userId (optional).
   Diagnostics/logging are configured based on env flags.
3. **Layout fetch** - `/api/overlay/layout/:workspaceId` returns an envelope. If absent, hydration treats it as an empty
   layout with default camera and inspectors.
4. **Metadata enrichment** - `resolvedFolders` + diagnostics (missing folders, workspace mismatches) are merged into the
   envelope so popups can show names/colors immediately while surfacing issues in overlays logs.
5. **Optimistic apply** - `applyOverlayLayout` diff-applies popups, inspectors, and camera. If the user dragged during
   hydration, the saved camera is skipped but the layout still marks itself dirty so persistence writes the live transform.
6. **Effects resume** - Hover popups, minimap (if flagged), layout-save timers, and diagnostic banners start running. The
   shared hover channel keeps previews aligned between toolbar and sidebar, and the minimap subscribes to the same data.

## Server APIs & Workspace Operations

### Layout API (`/api/overlay/layout/:workspaceId`)
- **GET**: Resolves `workspaceId` (or falls back to `WorkspaceStore.getDefaultWorkspaceId` when the route uses `default`),
  normalizes the layout, enriches it with metadata, and returns `{ layout, version, revision, updatedAt }`. `userId` is an
  optional query parameter (validated UUID); omitting it falls back to shared layouts.
- **PUT**: Validates `userId`, normalizes the payload, enforces `MAX_LAYOUT_BYTES`, and performs optimistic concurrency
  using `revision`. A 409 response returns the latest envelope for merges. Inserts occur when no layout exists for the
  given workspace/user pair. All saves are wrapped in a transaction so we never write partial data.
- Both handlers log and return `{ error }` on failure but avoid throwing sensitive errors to the client.

### Workspace Directory API (`/api/overlay/workspaces`)
- **GET**: Lists workspaces with `popupCount`, `updatedAt`, and `isDefault`, ordering by the most recently saved layout.
  Also returns the next recommended workspace name (e.g., “Workspace 4”).
- **POST**: Creates a new workspace (optionally honoring `nameHint`), immediately seeds it with the provided layout, and
  returns both the workspace summary and the persisted layout envelope.
- **DELETE**: Removes a workspace by ID. Errors are surfaced with descriptive messages when possible.

### Headers & Scoping
- Client requests add `X-Overlay-Workspace-ID` to all overlay-related fetches (layout saves, toolbar actions) so the
  backend can enforce workspace scoping without altering Knowledge Base fetches.
- Server-side helpers (`WorkspaceStore`, `withWorkspaceClient`) keep the default workspace cached per `pg.Pool` and set
  `app.current_workspace_id` for the session, satisfying any RLS policies.

## Infinite Canvas Behavior Details
- **Container bounds**: `recomputeOverlayBounds` uses the full `canvasRect` (plus generous margins) instead of subtracting
  the sidebar overlap. The wrapper relies on standard overflow handling rather than `clipPath`.
- **Pointer guard**: `handlePointerDown` first checks if the event target lies inside the sidebar’s bounding box; if so it
  aborts drag/pan logic so the sidebar can scroll/select without interference.
- **Visibility calculations**: `visiblePopups` tests against the virtual canvas, allowing negative coordinates or far
  offsets. Connection-line rendering is uncoupled from popup visibility so links stay visible while panning.
- **Debug log throttling**: Pointer-move logs respect both `NEXT_PUBLIC_DEBUG_LOGGING` and a dedicated drag-trace flag,
  only emitting at most four times per second. This keeps terminals quiet while still allowing targeted diagnostics.
- **Feature flag**: The behavior is gated by `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` (default `true`). Toggling it off reverts
  to the legacy clipped overlay for rollback.

## Overlay Minimap Behavior Details
- **Data adapter**: A dedicated selector (planned as `useOverlayMinimapData`) adapts the popup map and current transform
  into node definitions reused from the constellation minimap (id, position, optional depth). The hook memoizes results so
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
- **Hover preview parity**: The shared hover hook powers both floating-toolbar popover previews and sidebar hover previews
  (top-level and nested). It handles the hover delay, preview fetches, tooltip enter/leave, and cancelling folder close
  timers so hover popups stay open while users read a preview.

## Move Cascade & Pinning
- **Hand toggle behavior**: Clicking the hand icon within a popup header marks that popup as the cascade parent. The
  parent badge turns amber, a counter shows how many descendant popups are linked, and all linked popups receive the same
  highlight treatment so users can see the subtree that will move together.
- **Dragging & persistence**: While the cascade toggle is active, dragging the parent applies the same deltas (converted
  to canvas/world space) to every unpinned descendant. The shared `buildLayoutPayload` path writes the updated world
  coordinates plus the camera transform back to `overlay_layouts`, so workspace switching/remounting restores the new
  arrangement exactly.
- **Pin to Stay**: Cascade-linked children surface a “✋ Pin to Stay” control in their footers. Once pinned, those popups
  ignore subsequent cascade drags or close confirmations initiated by the parent, matching the existing close-mode pinning
  semantics.
- **Reset rules**: Turning the hand toggle off, closing any popup in the linked chain, or switching workspaces clears the
  `moveCascadeState`, removes the highlights, and reverts buttons to their default “Pin to Keep Open” wording.

## Workflow Summary
1. User selects a workspace via the toggle (Workspace 1, Workspace 2, etc.).
2. The overlay loads the saved layout for that workspace from `overlay_layouts`, applying the infinite canvas bounds if
   `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN=true`. Missing layouts hydrate as empty overlays with default camera.
3. The Knowledge Base sidebar remains unchanged—it still shows the global tree and captures pointer events inside its
   bounding box while overlay code uses scoped headers purely for persistence.
4. Users can click a sidebar folder eye icon, hover a top-level sidebar note eye, or use the floating toolbar’s `Org`
   button to open the Organization panel. Hovering a folder eye shows cascading folder popups; hovering a note eye shows
   the shared preview tooltip; clicking either restores the popup in the current workspace.
5. Optional: if `NEXT_PUBLIC_OVERLAY_MINIMAP=true`, the minimap mirrors popup positions and lets the user drag the
   viewport rectangle to recenter the overlay without fighting `PopupOverlay` gestures.

## Feature Flags & Observability
- `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` - Infinite canvas bounds (default `true`).
- `NEXT_PUBLIC_OVERLAY_MINIMAP` - Mounts the minimap (default `false` until QA finishes).
- `NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS` - Emits structured logs when layout saves hit revision conflicts.
- `NEXT_PUBLIC_DEBUG_LOGGING` + `NEXT_PUBLIC_DEBUG_POPUP_DRAG_TRACE` - Enable pointer-level drag logs (throttled).
- `NEXT_PUBLIC_COLLAB_MODE` / plain-mode detection - Determines whether overlay persistence always runs (plain) or warns
  when active elsewhere.
- `FEATURE_WORKSPACE_SCOPING` (server) - Controls whether workspace scoping helpers run; default enabled.
- Intent gates (`shouldLoadOverlay`) - Not an env flag, but treated like a feature gate so overlay work never races note
  hydration.

## Future Enhancements
- **Parity seeding**: Optionally clone the baseline Knowledge Base folders into each workspace to keep layouts and data
  perfectly aligned.
- **Click-time repair**: Offer users a “Clone into current workspace” action if a popup references an out-of-scope folder.
- **Minimap toggles**: Provide a user-facing toggle or gesture to collapse the minimap, plus optional clustering controls
  borrowed from the constellation path once the rollout stabilizes.
- **Notes-layer camera persistence**: Extend the layout payload with `notesCamera` so the note canvas restores alongside
  the overlay camera (see `docs/canvas/note/camera_persistence/plan.md`).
- **Background hydration instrumentation**: Add telemetry (`overlay_layout_hydrate_*`) to measure how often the camera
  replay is skipped and catch any regressions before rollout widens.
