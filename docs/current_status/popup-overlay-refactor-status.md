# Popup Overlay Refactor Status (2025-11-05)

## Overview
- Extracted shared popup row renderer, type definitions, and constants into `components/canvas/popupOverlay/` to shrink `popup-overlay.tsx` and concentrate list-row logic in reusable helpers.
- Rewired both primary render paths (canvas container and fallback overlay) to consume the shared renderer so folder/note rows behave identically regardless of mount target.
- Replaced duplicate inline types (`PopupData`, `PopupChildNode`, preview entries) and utility functions with the exported module surface; the overlay now imports `PopupData` and helper functions from `./popupOverlay/types` and `helpers`.
- Removed direct `console.log` instrumentation in favor of gated `debugLog` calls so verbose logging only emits when debug mode is explicitly enabled.
- Fixed hook ordering to avoid temporal-dead-zone access to `layerCtx` by instantiating `useLayer()` before constructing the memoized row renderer.
- Factored popup card header/footer into dedicated components shared by both live and fallback overlays, trimming repetition in `popup-overlay.tsx`.

## Key Code Changes
- `components/canvas/popup-overlay.tsx`
  - Imports `createPopupChildRowRenderer`, shared helper utilities, and exported types from `popupOverlay/`.
  - Memoizes the child row renderer via `useMemo`/`useCallback` right after `useLayer()` is called, ensuring `layerCtx` is initialized before use.
  - Both overlay render loops (primary and fallback) call `renderPopupChildRow(...)`, and list rendering guards against undefined child arrays.
  - Debug logging now funnels through `debugLog` instead of raw `console.log` calls.
  - Introduced internal `PopupCardHeader`/`PopupCardFooter` components and added a final pointer-up resize commit so user-driven dimensions persist reliably.
- `components/canvas/popupOverlay/renderPopupChildRow.tsx`
  - Houses the row rendering function with the shared interaction handlers (preview hover, selection, drag/drop, rename, folder hover highlighting).
  - Drops development-only logging and trims the options interface to what the overlay actually passes.
- `components/canvas/popupOverlay/helpers.ts`
  - Supplies common helpers (`clamp`, breadcrumb parsing, color theme lookup, relative-time formatting, node type guards) for the overlay and renderer.
- `components/canvas/popupOverlay/types.ts`
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
- [x] Wire unit coverage for `popupOverlay/helpers.ts` (breadcrumb parsing, relative-time) and the row renderer to prevent regressions. — See `__tests__/unit/popup-overlay.test.ts`.
- [x] Audit remaining `console.log` usage across overlay modules for potential conversion to `debugLog` (no active `console.log` calls remain; `console.warn`/`console.error` retained for user-facing failures).
- [x] Evaluate further component decomposition (e.g., header/footer subcomponents) to continue shrinking `popup-overlay.tsx`.
- [x] Confirm persistence logic (server PUT/save) still captures user-driven resizes after the shared renderer changes; added a pointer-up commit guard.
- [ ] Coordinate with backend team on eliminating layout conflict 409 spam to reduce “hydrating” overlays during panning.

### Backend Coordination (layout conflict 409s)
- Status: pending handoff — 409 spam persists and needs backend attention.
- Instrumentation: enable `NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS=true` to emit structured conflict telemetry via `debug_logs` (see `OverlayLayoutAdapter.saveLayout`).
- Action items:
  1. Capture a short repro (logs + steps) showing repeated `409 Conflict` responses when panning/hydrating popups.
  2. File/attach to the backend issue tracker and tag the persistence service owners.
  3. Once backend mitigation lands, retest popup hydration to confirm overlays remain stable without suppressing useful telemetry.
