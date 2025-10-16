# Canvas Camera & Panel Position Restoration (2025-10-15)

## Overview
- **Bug**: Newly-created notes snapped off-screen (lower-right) on reload and main/branch panels crept upward even when no drag occurred.
- **Impact**: Users lost viewport context; persisted panel titles were overwritten and panel geometry drifted, undermining workspace trust.
- **Goal**: Restore camera state deterministically on first reload, preserve panel titles, and seed accurate world-space coordinates.

## Symptoms Observed
- Dragged main panel returned to default offsets after refresh (camera reset to `translateX: -1000`, `translateY: -1200`).
- Main panel title always reverted to `"Main"`; branch panels remained positioned correctly.
- Brand-new notes (never dragged) reloaded with main + branch panels shifted upward.
- Workspace API already stored correct main-panel world coordinates, confirming persistence pipeline was healthy.

## Root Causes
1. **Camera Hydration Override**
   - `useCanvasHydration` dispatches `/api/canvas/camera/:noteId` results into context.
   - Camera persistence had been disabled; backend still stored default translate offsets.
   - Snapshot restore happened before hydration, but hydration overwrote it with stale defaults.
2. **Main Panel Seeding Regression**
   - On first load, the seeding effect (`persistPanelCreate`) ran because no `main` panel existed in the DB.
   - The payload hard-coded `title: "Main"` and used the current screen coordinates without measuring actual dimensions, writing inaccurate world positions.
   - Effect re-triggered each reload for brand-new notes, repeatedly re-clobbering title and geometry.
3. **Dimension Guessing**
   - Centering logic assumed a `600×800` panel. Real panels rendered closer to `520×440`, so the computed world center was biased upward.

## Fix Implementation
| Area | Change | File / Line Highlights |
| --- | --- | --- |
| Camera persistence | Restored snapshot writes back through `/api/canvas/camera/:noteId` immediately after local load, ensuring hydration reads accurate values. | `components/annotation-canvas-modern.tsx:365-378`, `:1011-1015` |
| Snapshot sync guard | Added `isRestoringSnapshotRef` to prevent the context-sync effect from racing while we hydrate. | `components/annotation-canvas-modern.tsx:235-1021` |
| Main-panel seeding | Guarded seeding with `mainPanelSeededRef` and reused existing title from `dataStore`/canvas items so we stop overwriting user content. | `components/annotation-canvas-modern.tsx:220-520` |
| Coordinate accuracy | Measured live DOM dimensions (fallback to stored dimensions) and converted to world-space based on current zoom instead of hard-coded values. | `components/annotation-canvas-modern.tsx:394-417` |
| Persistence payload | Sent measured screen dimensions through `persistPanelCreate` so DB width/height matches reality. | `components/annotation-canvas-modern.tsx:475-497` |
| Title preservation | Resolved main-panel title via `dataStore` rather than workspace metadata. | `components/annotation-canvas-modern.tsx:1403-1415` |

## Verification
1. `npm run type-check`
2. Manual flow:
   - Create new note, do **not** drag, reload → panel remains centered (no upward creep).
   - Drag panel to custom location, reload → viewport and branch panels rehydrate exactly.
   - Rename main and branch panels, reload → titles persist.
   - Check `/api/canvas/camera/:noteId` after reload → returns restored translate offsets (no defaults).

## Remaining Risks & Mitigations
- **DOM measurement availability**: On very early loads dimensions may be `0`. We fallback to stored dimensions or a conservative default. Consider deferring seeding until the layout effect confirms non-zero size.
- **Multi-user sync**: We still persist camera to shared row. For future per-user cameras, extend API payload to include user IDs (hook already supports it).
- **Offline queue**: Snapshot persistence currently POSTs directly; if offline, we lose that update. Long-term fix is to route through the existing offline queue (`canvasOfflineQueue`) for consistency.

## Next Steps
1. **Regression Tests**: Add Playwright or browser-driven tests that create new notes (dragged and untouched) and assert post-reload positions via minimap coordinates.
2. **Dimension API**: Expose a panel sizing helper in `usePanelPersistence` so other components can seed accurate dimensions without duplicating DOM queries.
3. **Per-user Camera Strategy**: Extend `/api/canvas/camera` with optional user scoping and update hydration to prefer per-user records when available.
4. **Offline Safety**: Wire camera snapshot writes through the offline queue to avoid losing viewport state when the tab closes offline.
5. **Workspace Seeding Telemetry**: Emit a one-time log event when main-panel seeding runs to help detect unexpected re-runs in production.

## References
- `components/annotation-canvas-modern.tsx` (viewport restore, seeding, camera patch)
- `lib/hooks/use-camera-persistence.ts` (unchanged but now paired again with backend updates)
- `app/api/canvas/camera/[noteId]/route.ts` (receives restored camera snapshot)
