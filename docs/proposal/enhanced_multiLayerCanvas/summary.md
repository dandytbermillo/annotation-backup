# Enhanced Multi-Layer Canvas – Current Status

## Overview
The original “Feature Flag Alignment” plan called for a unified gating model so the multi-layer canvas and LayerManager never diverge. Over the last set of changes we effectively hard-enabled the multi-layer path, removed the fragile flag mix, and added regression coverage around the scenarios that used to trigger `flushSync` warnings.

## What’s Implemented
- **Flag schema cleanup** (`lib/offline/feature-flags.ts`)
  - `ui.multiLayerCanvas` / `ui.layerModel` entries removed from the public flag list; any stale localStorage values are scrubbed via a sanitizer that logs `sanitize_runtime_flags`.
- **LayerManager hook simplified** (`lib/hooks/use-layer-manager.ts`)
  - Always returns the singleton LayerManager; `isEnabled` is hard-coded `true` and we emit a single `state_change` debug event tagged `permanent_enable`.
- **UI pathways assume multi-layer mode**
  - Canvas panel, layer controls, popup overlays, keyboard shortcuts, notes explorer, etc. all dropped their flag checks and run the multi-layer flow by default.
  - Canvas panel now blurs the editor via layer context (no `setEditable` shim) and the hover popup timeout was removed.
- **Popup overlay parity**
  - Hover popups now include a read-only TipTap preview fed by `/api/items/[id]`; the active note row is highlighted and previews are cached per popup.
- **Documentation + verification refreshed**
  - All canvas-component-layering docs now state that legacy fallback is gone and env toggles no longer exist.
- **Automated regression coverage**
  - Playwright spec (`e2e/multi-layer-canvas.spec.ts`) seeds a deterministic note, verifies hover popups no longer raise `flushSync`, and checks that the Tab key cycles the layer controls.

## What’s Not Implemented Yet
- **Additional automated tests** – Only the new Playwright spec covers layer switching + hover. No RTL/Jest unit tests assert LayerManager no-ops or popup fallbacks.
- **Lint debt** – The project still has longstanding ESLint warnings; nothing was changed there.
- **Legacy cleanup** – Some legacy fallback code paths (e.g., inline popup rendering when multi-layer is disabled) remain for completeness but are effectively unreachable now.

## Recommended Next Steps
1. **Expand testing**
   - Add unit/integration tests around `useLayerManager` to ensure calls no-op when the layer context is inactive (helpful if we ever reintroduce a flag for staging).
   - Broaden Playwright coverage: drag interactions on the popup layer, keyboard shortcuts beyond Tab (Cmd+1/Cmd+2), and negative cases where the overlay should stay hidden.
2. **Polish popup UX**
   - Explore richer interactions (scroll-to-preview target, keyboard navigation) and consider prefetch strategies so large folders don’t refetch content repeatedly.
3. **Housekeeping**
   - Run `npm run lint` and fix or suppress the accumulated warnings so future regressions are obvious.
   - Remove dead code related to the old single-layer path once we are confident we never need to revert.
4. **Monitoring**
   - Keep an eye on the `FeatureFlags` and `LayerManagerHook` debug logs in staging/prod dashboards to confirm every session reports `source: 'permanent_enable'`.

With these follow-ups, the multi-layer canvas will have tighter guarantees and better automated safety nets, closing the loop on the original alignment plan.
