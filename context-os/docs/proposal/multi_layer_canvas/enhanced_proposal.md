# Multi‑Layer Canvas: Popup Overlay As First‑Class Interactive Canvas

## Summary
Refactor the popup overlay into a first‑class interactive canvas with the same interaction model as the notes layer. Users pan the overlay via left‑click + drag (no modifier required when Popups are active) and zoom with the wheel (if enabled). While the Popups layer is active, the notes/apps layer is inert and non‑interactive, ensuring no input leaks.

This proposal folds in robust input handling (Pointer Events + pointer capture), clear transform ownership (single source of truth in LayerProvider), sync consistency, accessibility, and performance best practices.

## Decision
For true consistency, the popup overlay becomes a first‑class interactive canvas. Concretely:
1) Move pan handling into the `PopupOverlay` component itself.
2) Use the same mouse/pointer event patterns as the notes canvas (left‑click + drag pan; wheel zoom if enabled).
3) Have the overlay compute pan deltas and “manage” its transform by requesting updates from the LayerProvider (respecting sync policies).

## Goals
- Parity: Overlay pans exactly like the notes canvas (left‑click + drag).
- Cohesion: One mental model for panning across layers and devices (mouse, pen, touch).
- Safety: A single source of truth for transforms; no divergence between layers.
- Accessibility: Proper focus and interaction blocking of the background when Popups are active.
- Performance: Smooth pan/zoom via CSS transforms, batched via rAF.

## Current Gaps (observed)
- Overlay requires Space/Alt to pan; plain left‑drag doesn’t pan (unlike notes canvas).
- Overlay root uses `pointer-events: none`; empty‑space drags never start on the overlay.
- `updateTransform` is fed raw deltas as if they were absolute transforms, so movement doesn’t accumulate cleanly.
- With `syncPan` enabled, popups changes are overridden by notes transforms, canceling popup‑only panning.

---

## Proposed Design

### A) Pan Handling in PopupOverlay (first‑class)
- Attach Pointer Events on the overlay container. Prefer Pointer Events over mouse* to unify mouse, pen, and touch, and call `setPointerCapture()` on `pointerdown` so the pan doesn’t “break” if the pointer exits the overlay.
- Start pan only if the pointerdown happens on overlay empty space (not on interactive popup UI). Use a small hysteresis (3–5px) before engaging pan to disambiguate clicks.
- While panning, set `document.body.style.userSelect = 'none'` and toggle `will-change: transform` on the overlay container; remove both on pointerup/pointercancel.
- Keep connection SVG at `pointer-events: none` (purely visual) and popup cards at `pointer-events: auto`.
- CSS: set `touch-action` on the overlay to prevent the browser from stealing gestures.
  - Typical: `touch-action: none;` if fully custom gestures; or `touch-action: pan-x` / `pan-y` for constrained cases.

Minimal sketch (conceptual):
```ts
overlay.addEventListener('pointerdown', (e) => {
  if (!isOverlayEmptySpace(e)) return;
  overlay.setPointerCapture?.(e.pointerId);
  gesture.start = { x: e.clientX, y: e.clientY };
  gesture.last = { dx: 0, dy: 0 };
  gesture.engaged = false;
  document.body.style.userSelect = 'none';
  overlay.style.willChange = 'transform';
});

overlay.addEventListener('pointermove', (e) => {
  if (!overlay.hasPointerCapture?.(e.pointerId)) return;
  const dx = e.clientX - gesture.start.x;
  const dy = e.clientY - gesture.start.y;
  if (!gesture.engaged && Math.hypot(dx, dy) < 4) return; // hysteresis
  gesture.engaged = true;
  enqueueRafDelta(dx - gesture.last.dx, dy - gesture.last.dy);
  gesture.last = { dx, dy };
});

overlay.addEventListener('pointerup', endPan);
overlay.addEventListener('pointercancel', endPan);

function endPan() {
  overlay.releasePointerCapture?.(gesture.pointerId);
  document.body.style.userSelect = '';
  overlay.style.willChange = '';
  gesture = initial();
}
```
- Optional: For very high‑fidelity devices, read `event.getCoalescedEvents()` (and/or `pointerrawupdate`) to integrate smoother deltas; keep optional based on support.

### B) Match Notes Canvas Gestures & Wheel/Touch Behavior
- Left‑click + drag pans the active layer (overlay when Popups active); no modifiers required.
- Wheel zoom mirrors notes behavior. Normalize `WheelEvent.deltaMode` before applying zoom/pan deltas so Firefox/Windows trackpads feel correct. Use passive listeners by default; only register the canvas zoom handler as `{ passive: false }` if you must call `preventDefault()`.
- Keep Space/Alt as accelerators (e.g., forcing popup‑only pan regardless of active layer) but do not require them.

### C) Transform Model & Sync Policy
- Keep the single source of truth for transforms in `LayerProvider`.
- Provide an explicit delta API to avoid call‑site math leaks.

API extension:
```ts
type LayerId = 'notes' | 'popups';
type Delta = { dx: number; dy: number };
type Transform = { x: number; y: number; scale: number };

updateTransformByDelta(
  layer: LayerId,
  delta: Delta,
  opts?: {
    syncPan?: boolean;          // overrides global policy for this tick
    origin?: DOMPointReadOnly;  // for zoom ops
    txId?: number;              // gesture token for atomic batching
  }
): Transform;
```
- Provider responsibilities:
  - Accumulate deltas, apply sync policy once, and emit a single state update per rAF.
  - When `syncPan: true`, apply the same delta to both layers (not “copy notes absolute transform”), so popup‑only panning is never overwritten mid‑gesture.
  - When `syncPan: false`, apply delta only to the requested layer.
  - Maintain a per‑gesture token (`txId`) to treat all deltas atomically.
- Math model clarity (recommended):
  - World/View transform: `{tx, ty, scale}` for the active view.
  - Layer transform(s): same shape per layer; sync math is trivial (`⊕ delta`).
  - Node transform: per‑popup local transform (for dragging a single popup card).
  - Consider representing transforms with `DOMMatrix` or a tiny struct and compute `next = prev ⊕ delta` in one place.

### D) Gesture Arbiter (explicit scope)
- Introduce an internal “gesture arbiter” so per‑popup drags and layer pans never compete:
  - If a pointerdown starts on a popup header → scope: `popup-drag` (block layer pan until pointerup).
  - If it starts on overlay empty space → scope: `overlay-pan` (block per‑popup hits until pointerup).
- Keep a single “current gesture” token so the provider can treat deltas atomically during the gesture.

### E) Accessibility
- When Popups are active:
  - Set the notes/apps container `inert` (primary) and typically `aria-hidden="true"` (optional redundancy). Remove from tab order and assistive tech.
  - Treat the overlay root as a dialog surface: `role="dialog"` + `aria-modal="true"`; move initial focus to a predictable, focusable element; trap Tab/Shift+Tab inside the overlay.
  - Keyboard: Esc closes the overlay; provide roving tabindex or a sensible tab order across multiple popups. Ensure each popup has an accessible name (`aria-labelledby`).
- When returning to Notes: remove `inert`/`aria-hidden` and restore focus.

### F) Performance
- Use `translate3d()` (GPU compositing hint) and toggle `will-change: transform` only while panning.
- Keep popup content renders out of the hot path—pan should only adjust transforms, not React state inside popups.
- Continue batching updates in rAF inside `LayerProvider`.

---

## Implementation Plan (phased)
1) Input & Overlay Surface
   - Switch to Pointer Events in `PopupOverlay`.
   - Enable `pointer-events: auto` on the overlay container; keep SVG at `pointer-events: none` and cards at `pointer-events: auto`.
   - Add CSS `touch-action: none` on overlay.
2) Transform API & Sync
   - Add `updateTransformByDelta` in `LayerProvider`; treat deltas as deltas and accumulate to absolute transforms there.
   - Apply sync by delta when `syncPan` is on; isolate when off.
3) Gesture Arbiter
   - Add a small arbiter so popup header drag and overlay pan never overlap.
4) Accessibility & Focus
   - Apply `inert` to the notes/apps root when Popups are active; add `role="dialog" aria-modal="true"` to the overlay root; implement initial focus and Tab trap.
5) Performance polish
   - Toggle `will-change` during gestures; ensure no unnecessary re‑renders.
6) Feature flags & rollout
   - Gate under existing `ui.multiLayerCanvas` (and optionally `ui.overlayPanV2`), then dogfood and iterate.

## Test Plan
- E2E/Manual
  - Left‑drag on overlay empty space pans the overlay smoothly (with and without `syncPan`).
  - Dragging a popup header moves only that popup; overlay pan is not engaged.
  - Wheel zoom behaves consistently with the notes canvas; delta normalization verified on Firefox/Windows trackpads.
  - While Popups are active, notes/apps are non‑interactive (pointer & keyboard); focus is trapped in overlay; Esc closes.
  - Pinch‑to‑zoom (if enabled) does not fight touch‑action; double‑tap behavior is sensible.
- Edge cases
  - Scrollable popup content: starting inside scrollable areas scrolls, not pans (unless modifier forces pan), or require empty‑space start.
  - `pointercancel`/window blur gracefully ends the gesture.
  - Stacking contexts: overlay z‑order stays above notes while both layers transform.

## Acceptance Criteria
- Left‑click + drag pans the popup overlay with the same feel as the notes canvas.
- With `syncPan` on, both layers move together (same delta). With `syncPan` off, only popups move.
- Overlay root accepts empty‑space drags; popup header drags remain per‑popup and do not pan the layer.
- No accidental text selection or keyboard input reaches the background while Popups are active.
- Zoom (wheel) behavior matches the notes canvas across browsers/devices.

## Risks & Mitigations
- Sync overriding popups movement → Apply sync by delta, not by copying absolute transforms; unit test provider behavior.
- Conflicts between popup scroll and overlay pan → Require empty‑space start or a modifier to force pan; add hysteresis.
- Keyboard focus leakage → Use `inert` and a proper focus trap; Esc to close overlay.
- Performance regressions → Limit updates to transform changes; batch in rAF; toggle `will-change` only during gestures.

---

## Redlines / Paste‑in Snippets

Pan handling (Pointer Events + capture):
```ts
overlay.addEventListener('pointerdown', onPointerDown);
overlay.addEventListener('pointermove', onPointerMove);
overlay.addEventListener('pointerup', onPointerEnd);
overlay.addEventListener('pointercancel', onPointerEnd);
```

Wheel normalization (passive except when canceling):
```ts
container.addEventListener('wheel', onWheel, { passive: false }); // only if you call preventDefault()
// normalize: const units = e.deltaMode === 1 ? lineToPx : e.deltaMode === 2 ? pageToPx : 1;
```

CSS for touch behavior:
```css
#popup-overlay {
  touch-action: none; /* or pan-x / pan-y */
}
```

API (provider):
```ts
updateTransformByDelta('popups', { dx, dy }, { syncPan: undefined, txId });
```

---

## Notes on Codebase Integration
- Keep transforms single‑sourced in `LayerProvider`; `PopupOverlay` computes deltas and requests updates.
- Continue to honor existing `ui.multiLayerCanvas` flag; consider `ui.overlayPanV2` as a soft‑launch gate.
- Don’t unmount editors/apps on the notes layer—use `inert` and read‑only guards to prevent input while Popups are active.

