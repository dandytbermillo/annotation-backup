# Annotation Minimap Overlay Integration — Implementation Notes

## 1. Context
- **Problem:** The annotation minimap (and other fixed HUD items) remained visible above the overlay canvas, making popups look like they were rendered below HUD chrome. Additionally, portalling the overlay into the floating host caused that host to intercept pointer events everywhere—blocking sidebar interactions even where no overlay UI was rendered.
- **Goal:** Keep the minimap visually beneath the overlay canvas while ensuring HUD/sidebars remain interactive outside the overlay bounds.

## 2. Summary of Changes
1. **Global z-index tokens (previous step)**  
   - Added dedicated tiers in `lib/constants/z-index.ts` (`CANVAS_MINIMAP`, `OVERLAY_CANVAS`, `CONSTELLATION`, etc.) so HUD elements and canvases share a predictable stack order.

2. **Overlay portal (new work)**  
   - Reused the floating overlay host (`ensureFloatingOverlayHost()`) as the single portal target so the popup layer renders as a full-viewport, fixed-position surface (`components/canvas/popup-overlay.tsx:2573-2610`).
   - Kept the overlay positioned/fitted to the canvas bounds (respecting sidebar offsets) while still occupying a global stacking layer.

3. **Pointer-events fix**  
   - Left the floating host’s own `pointer-events` at `none` (its default) so it doesn’t block UI outside the overlay area.
   - Overlay element itself still sets `pointerEvents: 'auto'` when popups exist, so the popups capture interaction without preventing sidebar clicks.

## 3. Implementation Details
- **Full-screen host creation** (`components/canvas/popup-overlay.tsx:313-319`): on mount we ensure the `floating-notes-overlay-root` div exists and store it in `overlayContainer` for portal use.
- **Fixed overlay layer** (`components/canvas/popup-overlay.tsx:2573-2610`):  
  - `position: fixed` with `top/left/width/height` computed from the canvas bounds; includes a `clipPath` to guard the sidebar overlap margin.
  - Always uses the shared `Z_INDEX.POPUP_OVERLAY`, ensuring it renders above the minimap tier.
- **Host pointer-events guard** (`components/canvas/popup-overlay.tsx:3228-3238`):  
  - Host z-index is kept in sync, but `pointerEvents` stays `'none'` so only the overlay content intercepts input.

## 4. Verification
- **Manual checks**
  - Open overlay popups: minimap is hidden beneath the opaque overlay while popups remain interactive.
  - Interact with Organization / Constellation sidebar tabs: clicks register even while popups are active.
- **Automated**
  - `npm run lint` (pre-existing warnings remain; no new ones introduced).

## 5. Follow-ups / Risks
- Future overlay HUD (e.g., overlay minimap) should mount inside the floating host but may need its own clip path if it should avoid covering sidebars.
- If additional HUD items should remain visible over the overlay, they’ll need to render after the floating host with a higher z-index tier (e.g., toasts/modals already do).

