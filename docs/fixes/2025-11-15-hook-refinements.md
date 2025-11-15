# ModernAnnotationCanvas Hook Refinements

## Summary
- **Tests:** Added `__tests__/unit/use-canvas-note-sync.test.tsx` to lock in the regression fix where non-main panels hydrate from persisted world positions. The harness verifies that stored coordinates are applied immediately after hydration.
- **UI Hooks:** Extracted sticky overlay wiring (`useStickyOverlayElement`) and the dedupe-warning banner (`useDedupeWarningBanner`). ModernAnnotationCanvas now just renders the warning component and portal output without keeping bespoke state/effects inline.
- **Debug Effect:** Moved the canvas outline diagnostic log into `useCanvasOutlineDebug` so the component no longer hosts a one-off `useEffect`.

These refinements finish the refactor pass by ensuring all remaining inline effects either live in focused hooks or have direct test coverage.
