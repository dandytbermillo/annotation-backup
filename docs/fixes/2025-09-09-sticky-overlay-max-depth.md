# Sticky Overlay Mount Loop (Max Update Depth)

**Date:** 2025-09-09  
**Status:** Fixed  
**Affected Paths:**
- `components/annotation-canvas-modern.tsx`
- `lib/hooks/annotation/use-sticky-overlay.ts`

## Symptoms
- Browser console spammed `Maximum update depth exceeded...` immediately after loading the canvas.
- The sticky overlay DOM node mounted and unmounted on every render, triggering `setStickyOverlayEl` repeatedly and causing the effect to loop.

## Root Cause
When `useStickyOverlay` was introduced, the component passed inline arrow functions for the mount/unmount callbacks. Because those functions had new identities each render, the hook effect tore down and recreated the overlay every render, calling `setStickyOverlayEl` inside the effect and causing an infinite render loop.

## Fix
- Memoized the overlay mount/unmount handlers with `useCallback` before passing them into `useStickyOverlay`.  
- The stable callbacks keep the overlay effect from re-running unless the dependencies actually change, so the overlay mounts once and `setStickyOverlayEl` is no longer called recursively.

```tsx
const handleOverlayMount = useCallback((overlay: HTMLDivElement) => {
  setStickyOverlayEl(overlay)
}, [])

const handleOverlayUnmount = useCallback(() => {
  setStickyOverlayEl(null)
}, [])

useStickyOverlay(handleOverlayMount, handleOverlayUnmount)
```

## Verification
1. Reloaded the dev server (`npm run dev`).
2. Navigated to the annotation canvas: no console errors, sticky overlay attaches once.
3. Confirmed terminal no longer shows repeated overlay mount logs; pointer interactions operate normally.
