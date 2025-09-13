# Interaction Blocking Bug Analysis: Notes Draggable While Popups Active

This document captures the root cause and fix plan for the issue where notes remain draggable/interactable while the status indicator shows “popups”. No code is changed as part of this write‑up.

## Symptoms
- When the first hover popup appears the indicator correctly switches to “popups”, and when the last popup is closed it switches back to “notes”.
- Despite the indicator being “popups”, users can still drag and interact with note panels.

## Root Causes

1) Dual LayerProvider instances (state split)
- Notes Explorer (`components/notes-explorer-phase1.tsx`) wraps itself with a `LayerProvider` when the multi‑layer feature is enabled.
- The canvas gating in `components/annotation-app.tsx` uses `useLayer()` outside of that provider.
- Result: Two separate contexts exist. The explorer flips `activeLayer` to `'popups'` in its own provider (indicator updates), while the canvas sees a different provider (or the stub default) and thinks `activeLayer` is `'notes'`, so its `pointer-events: none` gate never activates.

2) Runaway panel z-index escalations
- `components/canvas/canvas-panel.tsx` sets `zIndex = Date.now()` on drag start. This can exceed the overlay and popup z‑index tokens (e.g., 100–3000), making panels sit above blockers/popups and still receive pointer events.

3) Click‑outside blocker disabled during popup drag
- In `components/notes-explorer-phase1.tsx` a click‑outside overlay is rendered only when `hoverPopovers.size > 0 && !draggingPopup`. While dragging a popup, the overlay is removed on purpose. If the canvas gating (pointer-events) isn’t active due to (1), the canvas remains interactive during popup drags.

4) Gating tied to wrong context
- `components/annotation-app.tsx` sets the canvas container style:
  - `pointerEvents: activeLayer === 'popups' ? 'none' : 'auto'`
  - If it reads from a different `LayerProvider` than the one being toggled by the explorer, the gate never engages.

## Evidence (code references)
- Provider in Explorer: `components/notes-explorer-phase1.tsx` (NotesExplorerPhase1 wraps its content with `LayerProvider` when flag enabled).
- Canvas gating: `components/annotation-app.tsx` sets `pointerEvents` based on `useLayer()`.
- Panel drag z-index escalation: `components/canvas/canvas-panel.tsx` sets zIndex to `Date.now()` during drag.
- Click‑outside overlay behavior: `components/notes-explorer-phase1.tsx` renders overlay only when not dragging a popup.

## Fix Plan (no implementation here)

1) Single LayerProvider for the app
- Move `LayerProvider` to `components/annotation-app.tsx` so it wraps both Notes Explorer and the canvas.
- Remove the nested `LayerProvider` from `NotesExplorerPhase1` (export a version that doesn’t auto‑wrap), or guard it (only wrap if no provider detected).

2) Cap panel z-index to sane values
- Replace `setZIndex(Date.now())` with a controlled, monotonic counter or use design tokens so panels never exceed popup/overlay layers.
- Example approach: base at `10`, increment by `1` on focus/drag. Ensure no panel z-index exceeds popup blockers.

3) Ensure gating applies during popup drag
- Either:
  - Keep the click‑outside overlay active even when `draggingPopup === true`, or
  - Rely entirely on the canvas `pointer-events: none` gate (as long as (1) guarantees it reads the correct provider state).

4) Validate provider wiring
- After moving to a single provider, verify that both the explorer’s auto‑switch effect and the canvas gating use the same `useLayer()` context.

## Verification Checklist
- Indicator flips to “popups” when any popup is open and back to “notes” when all are closed.
- While indicator is “popups”: 
  - Canvas container has `pointer-events: none`.
  - Panels are not draggable; clicks on panels do nothing.
  - If a popup is dragged, the canvas remains non‑interactive.
- Check a previously dragged panel’s computed `z-index`; it does not exceed overlay/popup layers.
- Return to normal: when all popups are closed, canvas pointer events return to `auto`, and panels are draggable again.

## Regression Considerations
- Keyboard panning (Space/Alt) and transform sync should still function; verify they operate only on the intended layer.
- Layer opacity/visibility sliders in LayerControls must still reflect the active provider state.
- Ensure Tab toggling between “notes”/“popups” matches canvas gating.

## Rollout
- Keep behind the existing `ui.multiLayerCanvas` feature flag until verified.
- Test in dev, then canary.

## References
- Provider: `components/canvas/layer-provider.tsx`
- Explorer: `components/notes-explorer-phase1.tsx`
- App wrapper + gating: `components/annotation-app.tsx`
- Panels: `components/canvas/canvas-panel.tsx`
- Z-index tokens: `lib/constants/z-index.ts`

