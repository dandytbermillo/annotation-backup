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
- `components/canvas/popup-overlay/renderPopupChildRow.tsx`
  - Houses the row rendering function with the shared interaction handlers (preview hover, selection, drag/drop, rename, folder hover highlighting).
  - Drops development-only logging and trims the options interface to what the overlay actually passes.
- `components/canvas/popup-overlay/helpers.ts`
  - Supplies common helpers (`clamp`, breadcrumb parsing, color theme lookup, relative-time formatting, node type guards) for the overlay and renderer.
- `components/canvas/popup-overlay/types.ts`
  - Exports `PopupData`, `PopupChildNode`, and preview-related types for consistent typing between overlay and renderer modules.
- `jest.config.js` / `tsconfig.jest.json`
  - Teach Jest to transpile TSX via `ts-jest`, enabling React-oriented unit coverage for the overlay.
- `__tests__/unit/popup-overlay.test.ts`
  - Adds coverage for helper utilities and the shared row renderer (hover previews, selection, double-click activation).

## Manual Verification Performed
- `npx jest __tests__/unit/popup-overlay.test.ts` (helpers + row renderer behaviors).
- Manual smoke test (developer-provided) previously confirmed overlay renders and interactions work post-refactor.

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
- [ ] Snapshot `components/canvas/popup-overlay.tsx` before any future refactors (store at `docs/backup/component/popup-overlay.tsx.YYYY-MM-DD.bak`) so revert cycles don’t lose context.
- [ ] Track live refactor scope inside this doc before coding (planned extractions, affected modules, manual tests) so the checklist never goes out of sync with reality.
- [ ] Follow-up extractions:
  - [ ] Move breadcrumb dropdown / preview plumbing completely into `useBreadcrumbs` (done) **and** document its manual test procedure here.
  - [ ] Evaluate splitting pan/auto-scroll logic into `useOverlayPanState` (existing hook) plus a dedicated pointer logger to keep `popup-overlay.tsx` under 2k lines.

### Manual Test Notes (current scope)
1. **Header reusable in both render paths** – open the Organization view (fallback overlay host) and a canvas-backed overlay to confirm badges, rename pencil, cascade “Link” button, and close controls match.
2. **Cascade button visibility** – ensure the `Link` button only shows for popups with at least one open child (regression guard added in `PopupCardHeader`).
3. **Breadcrumb dropdown + folder preview** – toggle the dropdown, hover ancestors to show preview, move pointer away to ensure preview hides after the delay.
4. **Fallback overlay host** – when `#canvas-container` is absent, `floating-overlay-root` renders the same header/footer components; this view doubles as the fallback test (Organization workspace already covers it).

### Backend Coordination (layout conflict 409s)
- Status: resolved after shipping the overlay lazy-load + autosave guard (`docs/canvas/note/decouple/overlay-lazy-load-plan.md`); `baseVersion=0` snapshots no longer fire, so layout saves stopped returning 409/stale-data errors in current runs.
- Instrumentation: keep `NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS=true` available for future incidents, but leave it off by default to reduce noise.
- Action items (only if regressions reappear):
  1. Re-enable the debug flag to capture structured conflict telemetry from `OverlayLayoutAdapter.saveLayout`.
  2. Record reproduction steps/logs and hand them to the persistence owners for investigation.
  3. After any backend change, rerun hydration tests to confirm overlays stay interactive without suppressing telemetry.
