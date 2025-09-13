Title: Multi‑Layer Canvas — Non‑Blocking Addendum (Input, Sync, A11y, Perf)

Context
- This addendum refines enhanced_proposal.md for the popup overlay/notes multi‑layer canvas.
- All items are non‑blocking: they can be adopted incrementally without disrupting current behavior.
- Target docs path after approval: context-os/docs/proposal/multi_layer_canvas/ADDENDUM_non_blocking_input_handling.md

Summary of Non‑Blocking Improvements
- Pointer Events everywhere: Replace mouse* handlers for overlay pan and popup header drags with Pointer Events + pointer capture.
- Delta‑first provider API: Add updateTransformByDelta with optional txId; keep math centralized.
- Delta sync (not absolute copy): When syncPan is true, apply the same delta to both layers.
- Wheel normalization and passive listeners: Normalize deltaMode; keep listeners passive unless preventDefault() is required.
- Touch behavior via CSS: Declare touch-action on overlay; use pan-x/pan-y selectively for scrollable regions.
- Gesture Arbiter: Single “current gesture” token ensures overlay-pan and popup-drag never compete.
- Accessibility: role="dialog" + aria-modal + initial focus on overlay; prefer inert on background.
- Performance: Toggle will-change only during gestures; prefer translate3d() for transforms.

Details and Redlines

1) Pointer Events + pointer capture (overlay and popup headers)
- Rationale: Unifies mouse/pen/touch; prevents broken drags when the pointer leaves the element; enables coalesced events.
- Redline:
  - Overlay root: pointerdown → setPointerCapture(pointerId); pointermove in rAF; pointerup/pointercancel → releasePointerCapture.
  - Popup header: same pattern with a small hysteresis (3–5px) before engaging drag.
  - End gestures on window blur and pointercancel.

2) Delta‑first provider API with gesture token
- Rationale: Keeps transform math in one place; enables atomic batching per rAF; cancels cleanly on cancel/blur.
- API sketch:
  - type LayerId = 'notes' | 'popups'
  - type Delta = { dx: number; dy: number }
  - type Transform = { x: number; y: number; scale: number }
  - updateTransformByDelta(layer: LayerId, delta: Delta, opts?: { syncPan?: boolean; origin?: DOMPointReadOnly; txId?: number }): Transform

3) Delta sync semantics
- Rationale: Avoids overwriting popup‑only movement when sync is enabled.
- Behavior: For syncPan:true, apply the same delta to both layers within the provider; do not copy absolute transforms between layers.

4) Wheel behavior and passive listeners
- Normalize WheelEvent.deltaMode (lines vs pixels) for magnitude‑based zoom or pan‑by‑wheel; keep listeners passive by default.
- If preventDefault() is necessary (e.g., canvas zoom), register only that handler with { passive:false }.

5) Touch behavior: declarative CSS
- Overlay root: touch-action: none; (or pan-x / pan-y as needed for constrained gestures).
- Scrollable popup children: retain native scroll by scoping gestures to overlay empty space; optionally allow a modifier to force pan.

6) Gesture Arbiter (scope token)
- On pointerdown: determine scope — "overlay-pan" or "popup-drag" — and claim a single token; block competing gestures until pointerup/cancel.
- Pass txId to provider so all deltas in a gesture are applied atomically per frame.

7) Accessibility and focus management
- Overlay root: role="dialog" and aria-modal="true" (or use the Popover API if preferred); send initial focus to a predictable element.
- Background: prefer inert on the notes/apps root; avoid duplicative aria-hidden unless required by the component library.
- Support Esc to close/dismiss overlay state where applicable.

8) Performance toggles
- During active gestures only: element.style.willChange = 'transform'; remove on end to avoid memory pressure.
- Prefer translate3d(...) in transforms to hint compositing on more GPUs.
- Keep React out of the hot path while panning (only update transforms; avoid content re‑renders).

9) Edge cases to verify (smoke tests)
- Scrollable children vs overlay pan (start on empty space or use a modifier).
- pointercancel and window blur end gestures gracefully.
- Hi‑DPI / trackpads: normalized deltas feel right across browsers.
- Stacking context: overlay remains above notes while both transform.

Minimal Pseudocode Snippets

// Overlay pan (Pointer Events + capture + hysteresis)
overlay.addEventListener('pointerdown', (e) => {
  if (!isOverlayEmptySpace(e)) return
  overlay.setPointerCapture?.(e.pointerId)
  state = { startX: e.clientX, startY: e.clientY, lastDX: 0, lastDY: 0, engaged: false, txId: Date.now() }
  document.body.style.userSelect = 'none'
  overlay.style.willChange = 'transform'
})

overlay.addEventListener('pointermove', (e) => {
  if (!overlay.hasPointerCapture?.(e.pointerId)) return
  const dx = e.clientX - state.startX
  const dy = e.clientY - state.startY
  if (!state.engaged && Math.hypot(dx, dy) < 4) return
  state.engaged = true
  const delta = { dx: dx - state.lastDX, dy: dy - state.lastDY }
  updateTransformByDelta('popups', delta, { txId: state.txId })
  state.lastDX = dx; state.lastDY = dy
})

function endPan() {
  overlay.releasePointerCapture?.(event?.pointerId!)
  document.body.style.userSelect = ''
  overlay.style.willChange = ''
  state = null
}
overlay.addEventListener('pointerup', endPan)
overlay.addEventListener('pointercancel', endPan)
window.addEventListener('blur', endPan)

// Wheel normalization (passive by default, opt out where needed)
container.addEventListener('wheel', (e) => {
  // If preventing native scroll:
  // e.preventDefault()
  const units = e.deltaMode === 1 ? lineToPx : e.deltaMode === 2 ? pageToPx : 1
  const dy = e.deltaY * units
  // apply zoom or pan based on policy
}, { passive: false })

Adoption Notes
- No wholesale rewrites are required. Convert overlay pan and popup header drag first; provider delta API can ship behind a flag.
- Accessibility and CSS touch-action can be added independently and verified with quick manual tests.
- Performance toggles are safe and local to gesture lifecycles.

Tracking
- When approved, copy this file to: context-os/docs/proposal/multi_layer_canvas/ADDENDUM_non_blocking_input_handling.md
- Cross-link from enhanced_proposal.md under “Related Addenda”.

