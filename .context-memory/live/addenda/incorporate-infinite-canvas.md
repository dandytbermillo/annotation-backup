Title: Incorporate Proven Infinite‑Canvas Patterns Into Multi‑Layer Canvas

Scope
- Adopt container transforms, GPU‑friendly transforms, viewport utilities, and optional LOD hooks from the `infinite-canvas` reference. Complements enhanced_proposal.md; no architecture change.

Goals
- Keep popups in canvas coordinates; move layers via container transform.
- Use translate3d(...) scale(...) during pan/zoom.
- Add viewport utils for selection/minimap.
- Add optional LOD hooks for smoother panning.

Design Overview
- Container: translate3d(tx,ty,0) scale(s), transformOrigin 0 0.
- Children: use stored canvasPosition only (no per‑render screen→canvas recompute).
- Provider: delta‑first updates; optional sync by delta.

A) Container Transform Discipline
- Store canvasPosition once; update only on header drag in canvas space.
- Render with left/top = canvasPosition under container transform.
- Remove any render‑time screen→canvas conversions.

B) translate3d For Hot Paths
- transform: translate3d(tx,ty,0) scale(s); toggle will-change during gestures.

C) Viewport Utilities
- Add canvas<->viewport helpers (point/rect) to support selection/minimap; centralize math.

D) LOD Hooks (Optional)
- data-gesture=true during pan; simplified PopupShell outside viewport.
- Use IntersectionObserver or distance checks.

Phases
- Phase 1: Container + translate3d; verify hit‑testing, no regressions.
- Phase 2: Viewport utils; optional selection demo.
- Phase 3: LOD behind flag.

Test Plan
- Interaction: pan all popups; header drag remains per‑popup; zoom around cursor.
- Performance: no layout thrash; stable FPS; LOD stabilizes dense screens.
- Cross‑browser: trackpads, Safari/iPad with touch-action policy.

Risks/Mitigations
- Extra layers → toggle will-change; profile.
- Math drift → centralize in viewport utils + unit tests.
- Visual popping → add margin hysteresis/fade.

Rollback
- Revert to translate(...) scale(...).
- Disable flags to restore current behavior.
