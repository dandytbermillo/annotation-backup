# Incorporate Proven Infinite‑Canvas Patterns Into Multi‑Layer Canvas
source path: /Users/dandy/Downloads/infinite-canvas-main 
## Scope
Adopt specific, non‑disruptive patterns from the `infinite-canvas` reference to strengthen our multi‑layer canvas, focusing on: container transforms, GPU‑friendly transforms, viewport utilities, and optional LOD hooks. This proposal complements `enhanced_proposal.md` and does not change the overall architecture (LayerProvider, delta‑first updates, Pointer Events, gesture arbiter).

## Goals
- Keep popup positions in canvas coordinates and move layers via a single container transform.
- Use `translate3d(...) scale(...)` on hot paths to encourage GPU compositing during pan/zoom.
- Introduce small, reusable viewport utilities for selection/minimap features.
- Add optional Level‑of‑Detail (LOD) hooks to reduce content churn while panning.

## Principles Borrowed (What to Copy)
- Container transform discipline: Children store canvas‑space coordinates; the container applies `translate/scale` for pan/zoom.
- GPU‑friendly transforms: Prefer `translate3d(...)` (with `will-change` during gestures) on containers that animate.
- Viewport utilities: Shared helpers for mapping between canvas and viewport to support selection/minimap.
- LOD hooks (optional): Simplify rendering of distant/offscreen content during heavy interaction.

## Design Overview
We retain our LayerProvider and delta‑first update model. Each interactive layer (notes, popups) renders:
- A container div with the active transform: `translate3d(tx, ty, 0) scale(s)` and `transform-origin: 0 0`.
- Children positioned using stored canvas coordinates (not recomputed from screen on each render).
- Pointer Events drive deltas into the provider; provider applies optional sync by delta in one place.

---

## A) Container Transform Discipline

Why
- Avoids position/transform cancellation bugs by never recomputing canvas coords from screen per render.
- Keeps math centralized and predictable; pan/zoom only change the container transform.

Changes
- Store `canvasPosition` once at popup creation; update only on header drag (in canvas space).
- Render popups using `left/top = canvasPosition` under the container transform.
- Do not derive `canvasPosition = screenToCanvas(...)` on each render; remove any remaining call‑site recomputation.

Minimal snippet (conceptual)
```ts
// On popup creation
const canvasPos = CoordinateBridge.screenToCanvas(initialScreenPos, layerTransform)
setPopup({ id, canvasPosition: canvasPos, ... })

// On popup header drag (delta already in screen space)
const deltaCanvas = CoordinateBridge.screenToCanvasDelta({ dx, dy }, layerTransform)
popup.canvasPosition = {
  x: popup.canvasPosition.x + deltaCanvas.dx,
  y: popup.canvasPosition.y + deltaCanvas.dy,
}
```

Acceptance
- Panning the popups layer moves all popups together smoothly; no visual cancellation.
- Dragging a single popup updates its `canvasPosition` while the container transform remains unchanged.

---

## B) Translate3d For Hot Paths

Why
- `translate3d(...)` often promotes the element to its own compositor layer, smoothing pan/zoom on a wide set of GPUs.

Changes
- Container style during interaction: `transform: translate3d(tx, ty, 0) scale(s)`.
- Toggle `will-change: transform` on pointerdown; remove on pointerup/pointercancel to avoid memory pressure.

Minimal snippet (conceptual)
```ts
overlay.style.willChange = 'transform' // on gesture start
overlay.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`
overlay.style.transformOrigin = '0 0'
// ... on end
overlay.style.willChange = ''
```

Acceptance
- Frame time remains stable during fast pans; no layout thrash in Performance panel.

---

## C) Viewport Utilities (Selection / Minimap)

Why
- Clear, shared helpers improve correctness when mapping between canvas and viewport, enabling selection rectangles and minimaps without bespoke math in each component.

Add small utilities (in `lib/utils/viewport.ts`)
```ts
export interface Transform { x: number; y: number; scale: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const canvasToViewport = (pt: {x:number;y:number}, t: Transform) => ({
  x: pt.x * t.scale + t.x,
  y: pt.y * t.scale + t.y,
})

export const viewportToCanvas = (pt: {x:number;y:number}, t: Transform) => ({
  x: (pt.x - t.x) / t.scale,
  y: (pt.y - t.y) / t.scale,
})

export const canvasRectToViewport = (r: Rect, t: Transform): Rect => {
  const p = canvasToViewport({ x: r.x, y: r.y }, t)
  return { x: p.x, y: p.y, width: r.width * t.scale, height: r.height * t.scale }
}

export const viewportRectToCanvas = (r: Rect, t: Transform): Rect => {
  const p = viewportToCanvas({ x: r.x, y: r.y }, t)
  return { x: p.x, y: p.y, width: r.width / t.scale, height: r.height / t.scale }
}
```

Usage examples
- Selection: convert drag rectangle (viewport) to canvas rect, then test component/popup intersections.
- Minimap: compute viewport rect in minimap space via known content bounds and current transform.

Acceptance
- Selection rectangle consistently matches visual elements regardless of zoom/pan.
- Minimap viewport tracks the visible area accurately while panning/zooming.

---

## D) LOD Hooks (Optional Phase)

Why
- Reduce expensive content work during fast gestures by temporarily simplifying offscreen or distant content.

Changes
- Add a lightweight LOD policy:
  - While a pan/zoom gesture is active, set `data-gesture="true"` on the container.
  - In popup card render, if `data-gesture` is true and the popup is outside the viewport by a margin, render a simplified shell (placeholder) or reduce opacity/pointer events.
- Optionally use `IntersectionObserver` to mark offscreen items; fallback to distance checks using current transform.

Minimal snippet (conceptual)
```ts
const isGestureActive = container.dataset.gesture === 'true'
const inViewport = isInViewport(canvasToViewport(popup.canvasPosition, t), { width: 300, height: popup.h })
return isGestureActive && !inViewport ? <PopupShell .../> : <PopupFull .../>
```

Acceptance
- During rapid pans, overall FPS remains stable; popups outside the viewport avoid re‑rendering heavy content.

---

## Incremental Adoption Plan
1) Phase 1 — Container + translate3d (low risk)
   - Ensure popups use stored `canvasPosition`; remove any per‑render screen→canvas recomputation.
   - Switch layer containers to `translate3d(tx,ty,0) scale(s)`; toggle `will-change` during gestures.
   - Verify no regression to pointer hit‑testing: overlay root `pointer-events: auto` only when active; connection SVG `none`; cards `auto`.

2) Phase 2 — Viewport utilities (selection/minimap readiness)
   - Add `viewport.ts` helpers and use them anywhere selection/minimap math appears.
   - Add a tiny selection demo (optional) gated by a flag.

3) Phase 3 — LOD hooks (behind a feature flag)
   - Add `data-gesture` toggling in gesture start/end.
   - Implement a minimal `PopupShell` rendering path; guard with `ui.lodPopups` flag.

## Test Plan
- Interaction
  - Pan popups layer: all popups move together smoothly; header drag still moves a single popup.
  - Zoom around cursor: elements scale predictably; selection hit‑testing remains correct.
- Performance
  - With Performance panel, verify minimal layout/paint during pan; container transform updates dominate (no content reflow).
  - With LOD flag on, measured FPS remains stable on dense screens (>30 popups).
- Cross‑browser
  - Chrome/Firefox/Edge on Windows trackpads: consistent wheel behavior.
  - Safari/iPad: touch pan/zoom do not fight `touch-action` policy.

## Risks & Mitigations
- Risk: translate3d creates extra compositor layers
  - Mitigation: toggle `will-change` only during gestures; remove on end; profile layers in DevTools.
- Risk: viewport math drift
  - Mitigation: centralize in `viewport.ts`; add unit tests for edge coordinates at different scales.
- Risk: LOD causes visual popping
  - Mitigation: small fade/opacity transition; add margin hysteresis before swapping shell/full content.

## Rollback Plan
- Container transform: revert to `translate(...) scale(...)` with no material behavior change.
- Viewport utilities: feature‑flag codepaths and keep existing math until verified.
- LOD hooks: behind `ui.lodPopups`; disable flag to restore full rendering.

## Appendix — Tiny Helpers
```ts
// Optional delta helper (pair with provider):
export const screenDeltaToCanvasDelta = (dx: number, dy: number, t: Transform) => ({
  dx: dx / t.scale,
  dy: dy / t.scale,
})
```

