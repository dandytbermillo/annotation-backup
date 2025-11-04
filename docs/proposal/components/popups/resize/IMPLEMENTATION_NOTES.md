# Popup Resize Implementation Notes (Validated)

## Scope & Goals
- Allow intentional width/height adjustments on overlay popups without touching their stored `canvasPosition`.
- Preserve layout persistence and connection-line accuracy while keeping the overlay interactive (no sidebar/pointer regressions).
- Limit the change surface to schema plumbing, popup state management, and opt-in resize affordances; no auto-reflow of children.

## Guardrails
- **Single source of truth**: `AnnotationApp` owns `canvasPosition`, `width`, and `height`. `PopupOverlay` renders using those props and only emits resize events.
- **No continuous DOM measurement**: Layout measurement is informational only; we sync size after explicit user actions (drag/resize) to avoid feedback loops that previously pushed popups off-screen.
- **Parent resize ≠ child move**: Resizing a parent never manipulates descendant coordinates. Users drag children explicitly if overlap occurs.
- **Easy rollback**: Resize affordances (handle + adapter) are opt-in. Removing them leaves schema fields inert.

## Current Code Validation
- Schema, API normalization, and hydration already carry `width`/`height` with defaults (300×400).
- `AnnotationApp`’s popup reducer tracks `width`/`height` and updates them via `handlePopupPositionChange`; plumbing to persist sizes is already in place.
- `PopupOverlay` renders cards using `popup.width/height`, so a resize handle can simply call back with new values.
- `ConnectionLineAdapter` derives edge intersections from each popup’s actual dimensions; lines already honor resize changes.

## Implementation Steps
1. **Add Resize Handle**
   - In `PopupOverlay`, render a lower-right affordance on each popup (↘). Pointer down captures the initial pointer position + dimensions.
   - During pointer move, compute deltas, clamp within `[200, 900]` (configurable), and call `onResizePopup(popupId, { width, height })`.

2. **State Adapter**
   - Wire `onResizePopup` in `components/annotation-app.tsx` to immutably update the targeted popup, clamp values, and mark the layout dirty so existing save logic persists the change.
   - No changes to `canvasPosition` during resize; only `width`/`height` mutate.

3. **Persistence**
   - `buildLayoutPayload` already serializes `width`/`height`, so saving/reloading will keep resized dimensions unchanged.

4. **Verification**
   - Resize a popup, ensure connection lines stay anchored to the adjusted edges.
   - Reload the workspace to confirm persistence.
   - Confirm overlay interactivity (layer toggling, pointer capture) still behaves.

## Optional Enhancements
- Keyboard nudging for finer-grained width/height adjustments.
- Visual indicators when a popup exceeds recommended dimensions.
- E2E smoke test covering resize + persistence.
