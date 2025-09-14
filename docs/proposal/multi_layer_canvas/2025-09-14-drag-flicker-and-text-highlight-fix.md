# Multi‑Layer Canvas: Drag Flicker and Text Highlight Fix

Status: implemented
Date: 2025-09-14
Owners: Canvas/Overlay

## Summary

Dragging across the canvas caused intermittent “blinking” of text (popups and other UI, except the sidebar). The blink often appeared after repeated release/re‑grip drags. Root causes were a combination of: a moving full‑viewport background inside a transformed overlay, native text selection starting between drags, and unstable composition during transforms. We applied minimal, targeted fixes to eliminate selection during drag, stabilize compositing, and ensure consistent event capture. The flicker is resolved.

## Symptoms

- While click‑dragging the canvas, text in popup cards and other UI would shimmer or appear to toggle between selected and unselected states.
- Issue reproduced more readily after releasing the mouse during a drag and quickly re‑gripping (multiple short drags in succession).
- Sidebar content did not blink (overlay excludes sidebar region).

## Environment Clues (from DevTools)

- Overlay structure:
  - Wrapper: `#popup-overlay.absolute.inset-0` (above canvas)
  - Transform container: `div.absolute.inset-0` with `transform: translate(...) scale(...)`
  - Previously: a full‑viewport transparent child `div.popup-background.absolute.inset-0` inside the transformed container
- Canvas used `translate(...) scale(...)`; popups move with overlay pan; header used `backdrop-blur-xl`.
- Some transform transitions were enabled when not dragging.

## Root Causes

1) Moving full‑viewport element under transform
   - The `div.popup-background.absolute.inset-0` sat inside the transformed container. On every drag frame it forced full‑area compositing work behind the overlay, amplifying apparent shimmer.

2) Native text selection between drags
   - On release/re‑grip, the overlay sometimes didn’t intercept the initial mousedown (pointerEvents gating), so the browser began a text selection on underlying content. The overlay then resumed panning, creating visible “select → unselect” flicker.

3) Subpixel transform + composition hints
   - Subpixel translate values and missing compositor hints made text re‑rasterization more likely during movement.

4) Expensive filters during motion (secondary)
   - Backdrop blur across large regions increases repaint cost and can magnify perceived flicker when other elements move.

## Fixes (Minimal and Targeted)

1) Remove the transformed full‑viewport background
   - Deleted the `div.popup-background.absolute.inset-0` nodes from the overlay’s transform container in both portal and fallback render paths.

2) Always capture overlay events when popup layer is active
   - Overlay wrapper now keeps `pointer-events: 'auto'` whenever the popup layer is active (instead of gating by “pointer inside”).
   - Ensures every mousedown routes to overlay, preventing native selection from starting between drags.

3) Harden selection prevention during drag
   - On drag start:
     - Add `html.dragging-no-select` class; set `body.style.userSelect = 'none'`.
     - Block `selectstart` and `dragstart` at capture phase; clear existing selection via `window.getSelection()?.removeAllRanges()`.
   - On drag end: remove handlers, restore styles, and remove class.
   - Applied to both popup overlay panning and canvas background panning.

4) Stabilize transforms and composition
   - Use `translate3d(..., 0)` with rounded pixel offsets for panning (`Math.round(x/y)`), reducing subpixel shimmer.
   - Add `will-change: transform` during active pan only.
   - Add `backface-visibility: hidden` and `transform-style: preserve-3d` on moving containers.
   - Contain paint where appropriate: `contain: layout paint` on overlay wrapper and canvas container.

5) Trim secondary contributors
   - Removed header `backdrop-blur-xl` used across the full width (kept appearance similar without blur for stability during motion).
   - Disabled per‑pointer‑move debug logging that previously sent network requests each frame.

## Files Changed

- `components/canvas/popup-overlay.tsx`
  - Removed `.popup-background` inside transformed container.
  - Selection guards: add/remove `dragging-no-select`, block `selectstart`/`dragstart`, clear selection.
  - Consistent event capture: `pointer-events: auto` when popup layer is active.
  - Compositor hints: rounded `translate3d`, `will-change` during pan, `backface-visibility`, `transform-style`, and paint containment on wrapper.

- `components/annotation-canvas-modern.tsx`
  - Canvas selection guards on background pan start/end.
  - Transform stabilization: rounded `translate3d`, `will-change` during drag, compositor hints.
  - Removed header `backdrop-blur-xl`; added container `contain: layout paint` and `isolation: isolate`.

## Why This Works

- Preventing selection eliminates the select/unselect flashes that were most obvious during repeated quick drags.
- Ensuring overlay consistently owns the initial mousedown stops the browser from ever starting a native selection between drags.
- Removing the transformed full‑viewport background reduces repaint/composition work, avoiding global shimmer.
- Rounding pixel offsets and using GPU‑friendly transforms keep text on stable layers during motion.

## Reproduction and Verification

Repro (pre‑fix):
1. Open a note and hover a folder to create popups.
2. Click‑drag the empty canvas area; release and re‑grip repeatedly.
3. Observe text flicker in popups and editor; sidebar unaffected.

Verify (post‑fix):
1. With popups visible, drag the canvas; repeat release/re‑grip many times.
2. No text highlighting starts; no blinking during drag.
3. Toggle zoom in/out; panning remains smooth; no shimmer.
4. Sidebar unaffected; overlay doesn’t block when popup layer is inactive.

## Performance Notes

- `will-change` is only active during pan to avoid unnecessary layer churn.
- Avoided global blur while moving; large `backdrop-filter` regions degrade performance.
- Removed per‑frame network logging during pointer move.

## Edge Cases and Considerations

- If future features require panning on the notes layer while popups are visible, ensure overlay’s active/inactive gating remains correct so event capture is routed appropriately.
- If additional overlays are introduced, avoid placing full‑viewport hit targets inside transformed containers.

## Rollback Plan

- Re‑introduce each change independently to isolate any regressions:
  1) Toggle selection guards off.
  2) Restore pointer‑events gating.
  3) Re‑add `.popup-background`.
  4) Revert transform rounding/compositor hints.
  5) Restore header blur.

## Appendix: Minimal Code Patterns

Disable selection during drag:

```ts
// on drag start
document.documentElement.classList.add('dragging-no-select')
document.body.style.userSelect = 'none'
document.addEventListener('selectstart', e => e.preventDefault(), true)
document.addEventListener('dragstart', e => e.preventDefault(), true)
window.getSelection()?.removeAllRanges?.()

// on drag end
document.documentElement.classList.remove('dragging-no-select')
document.body.style.userSelect = ''
document.removeEventListener('selectstart', handler, true)
document.removeEventListener('dragstart', handler, true)
```

Stable transform for moving containers:

```ts
style={{
  transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`,
  transformOrigin: '0 0',
  willChange: isDragging ? 'transform' : 'auto',
  backfaceVisibility: 'hidden',
  transformStyle: 'preserve-3d',
}}
```

Avoid full‑viewport elements inside transformed containers.

