# Popup Resize Implementation Notes (Refined)

## Scope & Goals
- Allow intentional width/height adjustments on overlay popups without touching their stored `canvasPosition`.
- Preserve layout persistence and connection-line accuracy while keeping the overlay interactive (no sidebar/pointer regressions).
- Limit the change surface to schema plumbing, popup state management, and opt‑in resize affordances; no auto‑reflow of children.

## Guardrails
- **Single source of truth**: `AnnotationApp` owns `canvasPosition`, `width`, and `height`. `PopupOverlay` reads these values but never writes back.
- **No continuous DOM measurement**: We only update coordinates after explicit drag/resize events. DOM observers are informational, not stateful, to avoid feedback loops that previously pushed popups off-screen.
- **Parent resize ≠ child move**: Resizing a parent never manipulates descendant coordinates. Users must drag children explicitly if overlap occurs.
- **Easy rollback**: The feature can be disabled by ripping out the resize handle + adapter while leaving schema fields inert.

## Data Model Updates
1. **Schema & Types**
   - Keep `width`/`height` on `OverlayPopupDescriptor` (`lib/types/overlay-layout.ts`). Sanitize via `app/api/overlay/layout/shared.ts`.
   - `lib/workspaces/overlay-hydration.ts` applies defaults (300×400) when missing.
2. **Client State Adapter**
   - Introduce `usePopupResizeAdapter` (or equivalent reducer) inside `components/annotation-app.tsx`. Responsibilities:
     - Clamp `width`/`height` within `[200, 900]` (configurable).
     - Update the targeted popup entry immutably and flag `layoutDirty`.
     - Persist via `buildLayoutPayload` on the existing save cadence.
   - Resize actions never mutate `position`/`canvasPosition`.

## PopupOverlay Rendering
- Render popups using provided `width`/`height` with a single resize affordance anchored in the lower-right corner (↘). The overlay layer:
  1. Captures initial pointer + dimensions.
  2. Computes deltas in screen space.
  3. Calls `onResizePopup(popupId, { width, height })`.
- Pointer capture + cursor changes live inside the overlay component, but measurement logic does **not** call `CoordinateBridge`.

## Connection Lines
- `lib/rendering/connection-line-adapter.ts` reads `popup.width`/`popup.height` (fallback to defaults). Anchor math remains derived-only; no writes to popup state.
- Add regression coverage to ensure anchors honor resized rectangles (left/right/top/bottom cases).

## Verification Strategy
1. **Unit tests**
   - Reducer/adapter: resizing clamps values, does not touch coordinates, persists dirty flag.
   - Hydration: missing `width`/`height` default correctly.
2. **Integration / manual**
   - Resize a parent, ensure child positions + connection lines stay stable.
   - Save workspace, reload, confirm dimensions persist.
   - Toggle layers (notes vs popups) and verify overlay interactivity remains intact.

## Open Follow-ups
- Optional keyboard nudging for fine-grained width/height changes.
- Visual indicator when a popup exceeds recommended dimensions (accessibility).
- E2E smoke test covering resize + persistence once infrastructure is ready.
