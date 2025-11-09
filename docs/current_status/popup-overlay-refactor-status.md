# Popup Overlay Refactor Status (2025-11-05)

## Overview
- Extracted shared popup row renderer, type definitions, and constants into `components/canvas/popup-overlay/` to shrink `popup-overlay.tsx` and concentrate list-row logic in reusable helpers.
- Rewired both primary render paths (canvas container and fallback overlay) to consume the shared renderer so folder/note rows behave identically regardless of mount target.
- Replaced duplicate inline types (`PopupData`, `PopupChildNode`, preview entries) and utility functions with the exported module surface; the overlay now imports `PopupData` and helper functions from `./popup-overlay/types` and `helpers`.
- Removed direct `console.log` instrumentation in favor of gated `debugLog` calls so verbose logging only emits when debug mode is explicitly enabled.
- Fixed hook ordering to avoid temporal-dead-zone access to `layerCtx` by instantiating `useLayer()` before constructing the memoized row renderer.
- Factored popup card header/footer into dedicated components shared by both live and fallback overlays, trimming repetition in `popup-overlay.tsx`.

## Key Code Changes
- `components/canvas/popup-overlay.tsx`
  - Imports `createPopupChildRowRenderer`, shared helper utilities, and exported types from `popup-overlay/`.
  - Memoizes the child row renderer via `useMemo`/`useCallback` right after `useLayer()` is called, ensuring `layerCtx` is initialized before use.
  - Both overlay render loops (primary and fallback) call `renderPopupChildRow(...)`, and list rendering guards against undefined child arrays.
  - Debug logging now funnels through `debugLog` instead of raw `console.log` calls.
  - Introduced internal `PopupCardHeader`/`PopupCardFooter` components and added a final pointer-up resize commit so user-driven dimensions persist reliably.
- `components/canvas/popup-overlay/hooks/usePopupSelectionAndDrag.ts`
  - New hook that owns preview hover fetches, tooltip lifecycle, selection tracking, folder hover highlights, and drag/drop state so `popup-overlay.tsx` no longer inlines ~400 lines of interaction logic.
- `components/canvas/popup-overlay/hooks/usePopupMeasurements.ts`
  - Integrated (2025-11-09) to handle resize pointer handlers, measurement queue batching, and auto-height commits, allowing the main overlay file to drop another ~250 lines of DOM measurement code.
- `components/canvas/popup-overlay/hooks/useOverlayViewport.ts`
  - Manages overlay bounds, pointer guard offsets, viewport culling, and minimap navigation so the component no longer keeps that logic inline.
- `components/canvas/popup-overlay/hooks/useConnectionLines.ts`
  - Memoizes the `ConnectionLineAdapter` output, keeping SVG connection rendering isolated from the main component and ready for future LOD tweaks.
- `components/canvas/popup-overlay/hooks/useOverlayPanState.ts`
  - Owns the transform refs, selection guards, and pointer handlers that previously lived inline in `popup-overlay.tsx`, shrinking the parent file by ~350 lines while keeping behavior identical.
- `components/canvas/popup-overlay/renderPopupChildRow.tsx`
  - Houses the row rendering function with the shared interaction handlers (preview hover, selection, drag/drop, rename, folder hover highlighting).
  - Drops development-only logging and trims the options interface to what the overlay actually passes.
- `components/canvas/popup-overlay/helpers.ts`
  - Supplies common helpers (`clamp`, breadcrumb parsing, color theme lookup, relative-time formatting, node type guards) for the overlay and renderer.
- `lib/workspaces/client-utils.ts`
  - Centralizes helpers that append/query/headers `workspaceId` parameters so every Knowledge Base mutation consistently targets the canonical workspace.
- `components/canvas/popup-overlay.tsx`, `components/floating-toolbar.tsx`, and `components/annotation-app.tsx`
  - Accept the resolved Knowledge Base workspace id, apply it to all `/api/items` calls (query + payload), and stop leaking overlay layout ids into data calls—bulk moves, create/rename/delete, and toolbar interactions now hydrate identically across workspaces.
- `components/annotation-app.tsx`
  - Folder cache entries now track fetch timestamps and invalidate automatically when folders mutate (create, delete, move) so popups never reuse stale snapshots.
  - Explicit folder opens (eye icon click) force a fresh `/api/items?parentId=...` fetch, while hover previews respect a short TTL to avoid spamming the API but still refresh after ~30 s.
  - Bulk move/delete flows update the shared cache (or flush it when the target popup isn’t open) to keep every workspace’s popups in sync with the global Knowledge Base.
- `components/canvas/popup-overlay/types.ts`
  - Exports `PopupData`, `PopupChildNode`, and preview-related types for consistent typing between overlay and renderer modules.
- `jest.config.js` / `tsconfig.jest.json`
  - Teach Jest to transpile TSX via `ts-jest`, enabling React-oriented unit coverage for the overlay.
- `__tests__/unit/popup-overlay.test.ts`
  - Adds coverage for helper utilities and the shared row renderer (hover previews, selection, double-click activation).

## Manual Verification Performed
- `npx jest __tests__/unit/popup-overlay.test.ts` (helpers + row renderer behaviors).
- Manual smoke test (developer-provided) previously confirmed overlay renders and interactions work post-refactor.
- `npm test -- __tests__/unit/popup-overlay.test.ts` (2025-11-09) after extracting the pan/auto-scroll hook.
- `npm test -- __tests__/unit/popup-overlay.test.ts` (2025-11-09, post selection/drag extraction) to ensure helper coverage still passes.
- `npm test -- __tests__/unit/popup-overlay.test.ts` (2025-11-09, post measurement/resize extraction) to verify helper coverage after wiring `usePopupMeasurements`.

## Recommended Manual Tests
1. Open a populated workspace and verify popup rows (hover preview, rename, multi-select, drag/drop) in the main overlay render path.
2. Trigger the fallback overlay (no canvas container) and confirm the same interactions behave identically.
3. Toggle overlay layer focus and perform a canvas pan to ensure debug telemetry only emits when debug logging is enabled.
4. Resize popups, then persist workspace to confirm size persistence remains unaffected.

## Next Steps / TODO
- [x] Wire unit coverage for `popup-overlay/helpers.ts` (breadcrumb parsing, relative-time) and the row renderer to prevent regressions. — See `__tests__/unit/popup-overlay.test.ts`.
- [x] Audit remaining `console.log` usage across overlay modules for potential conversion to `debugLog` (no active `console.log` calls remain; `console.warn`/`console.error` retained for user-facing failures).
- [x] Evaluate further component decomposition (e.g., header/footer subcomponents) to continue shrinking `popup-overlay.tsx`.
- [x] Confirm persistence logic (server PUT/save) still captures user-driven resizes after the shared renderer changes; added a pointer-up commit guard.
- [x] Coordinate with backend team on eliminating layout conflict 409 spam to reduce “hydrating” overlays during panning (overlay lazy-load/autosave guard stopped `baseVersion=0` writes, so conflicts no longer reproduce; keep telemetry handy in case they return).
- [x] Snapshot `components/canvas/popup-overlay.tsx` before any future refactors (store at `docs/backup/component/popup-overlay.tsx.YYYY-MM-DD.bak`) so revert cycles don’t lose context. — 2025-11-09 snapshot saved as `docs/backup/component/popup-overlay.tsx.2025-11-09.bak`.
- [x] Track live refactor scope inside this doc before coding (planned extractions, affected modules, manual tests) so the checklist never goes out of sync with reality. — See “Live Refactor Scope (2025-11-09)” below.
- [x] Follow-up extractions:
  - [x] Move breadcrumb dropdown / preview plumbing completely into `useBreadcrumbs` (done) **and** document its manual test procedure here. — See “Manual Test Procedure – Breadcrumb Dropdown.”
  - [x] Evaluate splitting pan/auto-scroll logic into `useOverlayPanState` (existing hook) plus a dedicated pointer logger to keep `popup-overlay.tsx` under 2k lines. — Completed via the refreshed `useOverlayPanState` hook (2025-11-09).

### Manual Test Notes (current scope)
1. **Header reusable in both render paths** – open the Organization view (fallback overlay host) and a canvas-backed overlay to confirm badges, rename pencil, cascade “Link” button, and close controls match.
2. **Cascade button visibility** – ensure the `Link` button only shows for popups with at least one open child (regression guard added in `PopupCardHeader`).
3. **Breadcrumb dropdown + folder preview** – toggle the dropdown, hover ancestors to show preview, move pointer away to ensure preview hides after the delay.
4. **Fallback overlay host** – when `#canvas-container` is absent, `floating-overlay-root` renders the same header/footer components; this view doubles as the fallback test (Organization workspace already covers it).
5. **Pan/auto-scroll regression sweep** – drag the overlay in both shared-camera and fallback-host modes to ensure pointer capture, selection guards, and minimap jumps still behave after moving the handlers into `useOverlayPanState`.
6. **Selection + drag/drop regression sweep** – hover eye icons to trigger previews, multi-select rows (Cmd/Ctrl + click, Shift+click), create/delete folders, and drag folders between popups to confirm the new `usePopupSelectionAndDrag` hook keeps tooltip timing, hover highlights, and drop targets in sync across both main and fallback overlays.
7. **Measurement/resize sweep** – drag the resize handle on several popups (including fallback host) to ensure sizes persist, auto-resize still activates when `sizeMode !== 'user'`, and measurements pause while panning/dragging.
8. **Connection lines** – in a workspace with multiple linked popups, pan/scroll so some popups leave the viewport and confirm the SVG connectors still match the visible popups; repeat in the fallback overlay host to ensure the new hook renders paths identically.

### Live Refactor Scope (2025-11-09 – Connection Line Extraction)
- **Status**:
  - *Selection/drag extraction:* Completed on 2025-11-09 — `usePopupSelectionAndDrag` now owns preview tooltips, hover highlights, selection state, and drag/drop plumbing, trimming ~400 lines.
  - *Measurement/resize extraction:* Completed on 2025-11-09 — `usePopupMeasurements` controls pointer resize handlers, measurement batching, and auto-height commits (≈250 lines removed).
  - *Overlay viewport/minimap extraction:* Completed on 2025-11-09 — `useOverlayViewport` now manages bounds/viewport/minimap logic, keeping `popup-overlay.tsx` focused on composition.
  - *Current objective:* extract the connection-line adapter wiring + visibility checks (currently handled inline via `ConnectionLineAdapter.adaptConnectionLines`, `visibleIdSetRef`, and observer plumbing) into a helper/hook so connection rendering is isolated and easier to test.
- **Constraints**: keep the existing `ConnectionLineAdapter` output identical (same `markerEnd`, opacity, stroke); preserve the intersection-observer gating (only draw lines for popups actually on screen), and retain the debug logging around container style if relevant.
- **Planned modules**:
  1. `components/canvas/popup-overlay/hooks/useConnectionLines.ts` (new) — computes `connectionPaths`, manages `visibleIdSetRef`/observers, and exposes the filtered connection data.
  2. `components/canvas/popup-overlay.tsx` — consumes the hook output when rendering `<svg>` lines, removing the inline observer bookkeeping.
- **Testing focus**: open a crowded workspace and ensure connection lines still respect visibility (lines disappear when popups scroll out); force the fallback overlay to confirm connectors still render with the new hook; toggle multi-select/drag to ensure connection rendering remains in sync with popups.

### Manual Test Procedure – Breadcrumb Dropdown
1. Open any popup with ancestors, click the breadcrumb pill to open the dropdown, and verify the dropdown renders left-aligned with a close (`×`) button.
2. Hover each ancestor row; confirm the preview panel displays that ancestor’s children and hides again within ~300 ms after hover exits.
3. Click the close (`×`) button to dismiss the dropdown immediately; re-open to ensure state resets.
4. Trigger the fallback overlay (remove `#canvas-container` or open Organization view) and repeat steps 1–3 to ensure both render paths share the same behavior.

### Backend Coordination (layout conflict 409s)
- Status: resolved after shipping the overlay lazy-load + autosave guard (`docs/canvas/note/decouple/overlay-lazy-load-plan.md`); `baseVersion=0` snapshots no longer fire, so layout saves stopped returning 409/stale-data errors in current runs.
- Instrumentation: keep `NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS=true` available for future incidents, but leave it off by default to reduce noise.
- Action items (only if regressions reappear):
  1. Re-enable the debug flag to capture structured conflict telemetry from `OverlayLayoutAdapter.saveLayout`.
  2. Record reproduction steps/logs and hand them to the persistence owners for investigation.
  3. After any backend change, rerun hydration tests to confirm overlays stay interactive without suppressing telemetry.
