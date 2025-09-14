# Smooth Dragging and Enhanced Scrolling Plan

Status: design ready (no code changes in this doc)
Date: 2025-09-14
Owner: Canvas/Overlay

## Context

- The “Uncategorized” popup contains a very large list (e.g., ~548 items) with icons and hover affordances.
- During overlay panning, React state (`setTransform`) triggers re-render of the whole overlay subtree every pointer move.
- Heavy DOM + per-frame re-render + composition under transform = visible drag heaviness on large popups (small popups feel fine).
- Our multi-layer canvas already uses compositor-friendly transforms, selection guards, and reduced backdrop blur; remaining bottleneck is render volume and update pattern.

## Goals

- Maintain 60 fps during canvas/popup drag even with very large popup lists.
- Avoid per-frame React reconciliation for panning; keep UI stable regardless of popup size.
- Minimize layout/paint work for list content that is not visible during drag.

## Root Causes (Why “Uncategorized” feels heavy)

- Large DOM: hundreds of rows with icons and hover states inside a moving container.
- Per-frame React setState on transform change forces overlay subtree to re-render.
- Hover effects and transitions on list items add property churn during pointer moves.
- Viewport culling and mapping still run during pan when transform is in React state.

## Adopted Patterns from `infinite-canvas-main`

Reference: `/components/infinite-canvas/simple-drag-handler.tsx`

- Throttled drag loop (~16ms): coalesce pointermove events using `performance.now()` guards.
- Localized updates: directly update the dragged element’s style or a narrow slice of state, avoid full-subtree renders.
- Compositor hints: disable transitions while dragging, and apply GPU-friendly transforms.

## Proposed Architecture Changes (Non-breaking, staged)

1) Decouple pan from React re-renders
- Keep canonical transform in a ref (e.g., `transformRef`), not state.
- On pointermove, update `containerRef.style.transform` via `requestAnimationFrame` (RAF) + throttle.
- On pointerup, commit the final transform back to React state (for persistence or future calculations).

2) Throttle and coalesce move events
- Guard updates to at most once per 16ms (60 fps). Ignore extra pointermove events in between.

3) Memoize popup bodies and row lists
- Ensure popup content does not re-render when transform changes. Move transform to a parent container’s inline style only.
- Use `React.memo` or equivalent for popup cards and rows.

4) Virtualize large popup lists (thresholded)
- For popups with many rows (e.g., >200), render only visible rows in the 300×400 viewport.
- Alternatives if full virtualization is deferred:
  - Use `content-visibility: auto` on the scrollable list container.
  - Apply `contain: content` and avoid costly shadows/transitions on rows while panning.

5) Pause hover/animations during pan
- While `isPanning` is true, disable row hover background transitions and icon fades to reduce per-frame style recalculation.

6) Keep compositor stable
- Continue using `translate3d(...)` with rounded pixel offsets and `will-change: transform` during pan only.
- Avoid adding full-viewport elements inside transformed containers.

## Implementation Plan (Phased)

Phase 1 — RAF-driven pan (no UI behavior changes)
- Add `useRafPan` hook:
  - Holds `transformRef` and `lastTsRef`.
  - `onPointerMove` stores deltas; a RAF callback applies `containerRef.style.transform` using `translate3d(Math.round(x)px, Math.round(y)px, 0) scale(scale)` at most once/16ms.
  - `onPointerUp` commits `transformRef.current` to React state.
- Remove `setState` calls on every move; retain only style updates.

Phase 2 — Memoization
- Wrap popup card component and heavy row components with `React.memo`.
- Ensure props don’t change during pan (no `transform` prop drilling).

Phase 3 — List virtualization for big popups
- Introduce a lightweight virtual list for popup content when `items.length > THRESHOLD`.
- Keep DOM nodes around the visible window only, with an overscan (e.g., 4–6 rows).

Phase 4 — Interaction polish
- During pan: suppress hover styles/transitions on rows and icons.
- After pan ends: restore transitions.

Phase 5 — Optional micro-optimizations
- Replace inline SVG icons in long lists with a single sprite/CSS mask to cut DOM weight.

## Pseudocode / Skeletons

RAF-driven pan decoupled from React:

```ts
// inside PopupOverlay or a dedicated hook
const transformRef = useRef({ x: 0, y: 0, scale: 1 })
const rafRef = useRef<number | null>(null)
const lastTsRef = useRef(0)

function scheduleApply() {
  if (rafRef.current) return
  rafRef.current = requestAnimationFrame((ts) => {
    rafRef.current = null
    if (ts - lastTsRef.current < 16) return // throttle ~60fps
    lastTsRef.current = ts
    const { x, y, scale } = transformRef.current
    if (containerRef.current) {
      containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`
    }
  })
}

// pointermove handler
function onMove(e: PointerEvent) {
  // update transformRef deltas here
  transformRef.current.x += e.movementX
  transformRef.current.y += e.movementY
  scheduleApply()
}

// pointerup handler
function onUp() {
  // persist transformRef.current to React state once
  setTransformState(transformRef.current)
}
```

Virtualization trigger (thresholded):

```ts
const shouldVirtualize = items.length > 200
return shouldVirtualize ? (
  <VirtualList items={items} itemHeight={rowH} height={400} />
) : (
  <StaticList items={items} />
)
```

CSS containment for scroll area:

```css
.popup-list {
  contain: content;
  content-visibility: auto;
}
```

Hover suppression while panning:

```tsx
const rowStyle = isPanning ? { transition: 'none' } : undefined
```

## Performance Budget & Instrumentation

- Target: ≤ 16ms per frame during drag; avoid React renders in the hot path.
- Add simple FPS sampling (RAF loop) only in dev builds; remove per-pointer-move network logs.

## Risks & Rollback

- Virtualization affects list keyboard/scroll behavior: ensure ARIA roles and scroll sync are preserved.
- RAF-driven style updates must be cleaned up on unmount; keep commit-on-end to synchronize canonical state.
- Rollback by toggling back to React-managed transforms while we evaluate.

## Verification Checklist

- Repeated press-drag-release cycles remain smooth with 500+ items.
- Zoomed and non-zoomed panning stay at 60 fps.
- Hover visual polish returns immediately after drag end.
- No regression to selection/highlight (guards remain in place).

## References

- `infinite-canvas-main/components/infinite-canvas/simple-drag-handler.tsx` — throttled updates, localized state writes, drag style toggles.
- `infinite-canvas-main` docs: immediate-improvements-solution.md, detailed-improvement-guide.md

```
This document proposes patterns and a phased plan only. No code changes were made as part of this commit.
```

