# Terminal Spam – Overlay Fetch Loops (2025-11-10)

## Symptoms
- On every app reload the dev server logged alternating `GET /api/items?parentId=null` and `GET /api/items?<knowledge-base-folder>` requests, even when the overlay layer was never opened.
- After activating the overlay layer and switching between overlay workspaces, the terminal printed an endless stream of `GET /api/overlay/layout/:workspaceId` entries.

## Root Causes
1. `components/annotation-app.tsx` always mounted `useKnowledgeBaseSidebar`, so the sidebar loader fetched Knowledge Base folders immediately on every render. The lazy-load flag (`shouldLoadOverlay`) was never consulted, so overlay data hydrated during note-only reloads.
2. `useOverlayLayoutPersistence` reset `layoutLoadedRef` to `false` whenever `currentWorkspaceId` changed, but only set it back to `true` inside an effect that depended on `overlayPopupsLength`. When switching between workspaces that have the same popup count (especially both empty), that effect never ran, so the hook kept calling `adapter.loadLayout()` every render, causing repeated `/api/overlay/layout/...` requests.

## Fixes
- Gate `useKnowledgeBaseSidebar` behind `enabled: shouldLoadOverlay` and memoize its loader deps so Knowledge Base fetches only run after the user opts into the overlay layer.
- Pass the full `overlayPopups` array into `useOverlayLayoutPersistence` and flip `layoutLoadedRef.current` to `true` as soon as the initial layout commit finishes, regardless of popup count. This restored one-shot hydration when switching workspaces and stopped the layout load loop.

## Verification
1. Reload the app while staying on the notes layer: no `/api/items` requests fire until you switch to the overlay tab or trigger a popup action.
2. Activate the overlay layer, switch between two workspaces (including empty ones): for each switch you should see at most a single `GET /api/overlay/layout/:workspaceId`, and the log stops once the layout loads.
