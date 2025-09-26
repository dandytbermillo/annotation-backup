# Enhanced Multi-Layer Canvas Feature Flag Alignment

## Background
The canvas stack currently relies on `ui.multiLayerCanvas` to toggle between legacy single-layer panels and the LayerManager-based multi-layer canvas. Over time, the flag drifted from its original intent:

- `lib/offline/feature-flags.ts` sets `ui.multiLayerCanvas` to `true` by default, but there is **no complementary flag for the layer model**.
- `lib/hooks/use-layer-manager.ts` enables the `LayerManager` whenever `process.env.NEXT_PUBLIC_LAYER_MODEL !== '0'`, ignoring `ui.multiLayerCanvas` entirely.
- Several components (panels, popup overlays, layer keyboard shortcuts) still check `useFeatureFlag('ui.multiLayerCanvas')`, but the underlying LayerManager remains active even when the flag is `false`.

As a result, disabling the flag yields a confusing hybrid: layer-aware UI disappears, yet LayerManager logic keeps reordering panels and popups. To support ongoing canvas work (multi-panel layouts, pan mode, Zoom), we need a single, future-proof switch.

## Current State (Key References)
- **Feature flag definitions** – `lib/offline/feature-flags.ts`
- **LayerManager hook** – `lib/hooks/use-layer-manager.ts`
- **Canvas panel integration** – `components/canvas/canvas-panel.tsx`
- **Layer-aware UI** – `components/canvas/layer-controls.tsx`, `components/canvas/popup-overlay.tsx`, `components/canvas/popup-overlay-improved.tsx`
- **Keyboard shortcuts** – `lib/hooks/use-layer-keyboard-shortcuts.ts`

## Problems Observed
1. `ui.multiLayerCanvas` and environment variable `NEXT_PUBLIC_LAYER_MODEL` compete, causing inconsistent behaviour.
2. Missing flag entries (`ui.layerModel`, `ui.panMode` etc.) fall back to `undefined`, so the environment check always enables the manager.
3. Tests and staging cannot reliably simulate the legacy single-layer mode because toggling the flag leaves LayerManager partially active.
4. Future canvas work (panel resizing, pan-mode) depends on predictable layer presence.

## Recommendation Overview
- **Single source of truth:** introduce `ui.layerModel` in the flag schema and deprecate the ad-hoc env check. Let `ui.multiLayerCanvas` remain as the public switch (or merge both into one flag).
- **Explicit defaults:** set both `ui.multiLayerCanvas` and `ui.layerModel` to `true` (current behaviour), but allow staging/prod overrides without touching code.
- **Fail-closed when disabled:** when the flag is `false`, ensure panels stop registering with the layer manager, popup overlays fall back to single-layer rendering, and layer controls/shortcuts stay hidden.
- **Document rollout strategy:** clarify dev/staging/prod values and how QA can force single-layer mode for regression testing.

## Step-by-Step Plan

### 1. Extend Feature Flag Schema (lib/offline/feature-flags.ts)
```ts
interface FeatureFlags {
  'offline.circuitBreaker': boolean;
  'offline.swCaching': boolean;
  'offline.conflictUI': boolean;
  'ui.multiLayerCanvas': boolean;
  'ui.layerModel': boolean;      // NEW alias for LayerManager
  'ui.panMode': boolean;         // Optional: cover existing casts
}

const DEFAULT_FLAGS: FeatureFlags = {
  'offline.circuitBreaker': false,
  'offline.swCaching': false,
  'offline.conflictUI': false,
  'ui.multiLayerCanvas': true,
  'ui.layerModel': true,
  'ui.panMode': false,
};
```
- Ensure `useFeatureFlag` recognises the new keys (no `as any` casts).
- Optional: migrate stored localStorage flags by merging missing keys with defaults.

**Backfill requirement:** ship a one-time migration utility (run on boot) that reads any persisted flag blobs, injects defaults for missing keys (`ui.layerModel`, `ui.panMode`), and re-saves the result. Log when the migration runs so QA can confirm the hybrid state cannot persist.

```ts
const defaults = DEFAULT_FLAGS;
let mutated = false;
(['ui.layerModel', 'ui.panMode'] as const).forEach(flag => {
  if (!(flag in runtimeFlags)) {
    runtimeFlags[flag] = defaults[flag];
    mutated = true;
  }
});

if (mutated) {
  try {
    localStorage.setItem('offlineFeatureFlags', JSON.stringify(runtimeFlags));
    debugLog('FeatureFlags', 'layer_model_migration', runtimeFlags);
  } catch (error) {
    console.error('[FeatureFlags] migrate failed', error);
  }
}
```

Wrap storage access in `try/catch` so failed writes do not block boot, and use `debugLog` (or structured console info) to emit a clear trace that QA can screenshot.

### 2. Deprecate Environment Overrides
- Remove `process.env.NEXT_PUBLIC_LAYER_MODEL` fallback in `useLayerManager()` and use only `useFeatureFlag('ui.layerModel')`.
- Add a helper `isLayerModelEnabled = useFeatureFlag('ui.layerModel') && useFeatureFlag('ui.multiLayerCanvas');` if you want a single public toggle.
- Update documentation to mention new environment variables (`NEXT_PUBLIC_FEATURE_FLAGS` or localStorage) for QA toggles.

### 3. Gate LayerManager Usage Everywhere
- **lib/hooks/use-layer-manager.ts**:
  - `const isLayerModelEnabled = useFeatureFlag('ui.layerModel') && useFeatureFlag('ui.multiLayerCanvas');`
  - Remove `process.env.NEXT_PUBLIC_LAYER_MODEL` entirely and rely on `isLayerModelEnabled` for every registration check / public API branch.
  - Keep existing no-op returns but add an explicit `if (!isLayerModelEnabled) { return emptyState; }` to reduce ambiguity.
- **lib/hooks/use-layer-keyboard-shortcuts.ts**, **layer-controls.tsx**, **canvas-panel.tsx**, **popup-overlay*.tsx**:
  - Replace direct `useFeatureFlag('ui.multiLayerCanvas' as any)` calls with the typed combined flag and delete `as any` casts everywhere.
  - Guard derived behaviour (e.g., `header.style.cursor = 'move'`, `layerManager.focusNode`) behind `if (isLayerModelEnabled)` so legacy mode uses simple z-index ordering.

### 4. Fallback Logic When Disabled
- **Panel behaviour** (`components/canvas/canvas-panel.tsx`):
  - Skip `layerManager.focusNode/panelId` calls when the flag is off.
  - Use traditional z-index stacking / manual focus.
- **Popup overlays:** render inline (single layer) when the feature is off (e.g., reuse existing legacy popup rendering helper or create a lightweight inline map) and suppress LayerManager registration; log the mode so QA can verify fallback execution.
- **Keyboard shortcuts:** do not register layer-specific shortcuts when disabled.

### 5. Runtime Toggle Behaviour
- Detect combined-flag changes inside `useLayerManager` (or a shared observer) and detach registered nodes before returning to legacy mode; avoid partial states by clearing subscriptions on `true → false`.
- Instrument `setFeatureFlag` so any runtime overrides touching `ui.multiLayerCanvas` or `ui.layerModel` recompute `isLayerModelEnabled`, emit a structured `layer_model_toggle` event via `lib/utils/debug-logger.ts#L26` (or equivalent analytics hook), and optionally surface a dev banner prompting reload if a hard refresh is safer than hot-switching.
- Document the user-facing UX: e.g. toast advising reload vs. seamless switch, and note which environments (dev/staging) support live flipping.

### 6. Telemetry & Observability
- Emit telemetry on every transition path using the shared debug logger:
  - Initial boot: log `isLayerModelEnabled` plus flag sources (default vs override) so dashboards can spot unexpected legacy sessions.
  - Runtime overrides: the `setFeatureFlag` instrumentation above should forward structured payloads (`enabled`, `source_multi`, `source_layerModel`).
  - (Optional) remote-config updates: ensure the same logging fires if remote flags change on refresh.
- Surface a dev-facing indicator (console badge or debug HUD) showing the active canvas model and expose `window.__canvasModel` for quick inspection during QA.
- Route logs to existing analytics/observability pipelines and configure alerts for unexpected `enabled=false` events in production.

### 7. Validation Matrix & Rollout
- **Unit coverage:** expand `useLayerManager` tests to assert every public method no-ops when `isLayerModelEnabled` is `false`, and verify layer controls / popup overlays render only when both flags are `true`.
- **Integration testing:** automate a scenario that flips the combined flag during a session (localStorage + `storage` event) and checks panels/popups revert to manual z-index ordering without console errors, including validation that popups fall back to inline rendering instead of disappearing entirely.
- **Manual QA matrix:** run desktop + tablet breakpoints, zoom in/out, nested panel focus (notes + explorer), popup stacking, keyboard shortcuts, and isolation/collab touchpoints in both modes, capturing results in the rollout checklist.
- Update README / ops guide with explicit flag toggling instructions so QA can reproduce both states in each environment.

### 8. Implementation Guardrails
- Stage behavioural refactors (e.g., panel height expansion, zoom math) separately from the flag alignment to avoid the Isolation Reactivity anti-pattern (provider/UI contract drift).
- During rollout, update change logs to note that LayerManager-dependent UI must ship behind the new combined flag, preventing partial deployments.

### 9. Future-Proofing & Retirement Strategy
- **Exit criteria:** retire legacy mode only after telemetry shows sustained `<1%` usage and two consecutive releases without single-layer blockers. Track these metrics in the dashboards configured above.
- **Decision log:** document sunset approvals (and any staging dry runs) in `docs/proposal/enhanced_multiLayerCanvas/` and flag the timeline in changelogs so teams know when fallbacks disappear.
- **Flag consolidation:** when confidence is high, either alias `ui.layerModel` to `ui.multiLayerCanvas` (single canonical flag) or plan an always-on release that removes both toggles; prepare diffs to excise no-op branches, legacy LayerProvider fallbacks, and redundant tests once the switch is permanent.
- **Telemetry lifecycle:** schedule cleanup of toggle events after retirement (e.g., replace with one-time “multi-layer always on” boot log) to reduce noise while preserving historical context.
- **Forward guardrails:** keep PR checklists / lint rules enforcing combined-flag gating for new canvas features until the legacy path is fully removed to prevent regression into hybrid states.

## Affected Files
- `lib/offline/feature-flags.ts`
- `lib/hooks/use-layer-manager.ts`
- `components/canvas/canvas-panel.tsx`
- `components/canvas/layer-controls.tsx`
- `lib/hooks/use-layer-keyboard-shortcuts.ts`
- `components/canvas/popup-overlay.tsx`
- `components/canvas/popup-overlay-improved.tsx`
- Any modules casting missing flags (`useFeatureFlag('ui.panMode' as any)`, etc.)

## Validation Plan
1. **Unit coverage:** Extend Jest/React tests for `useLayerManager` to assert that public methods no-op when the flag is false.
2. **Visual regression:** In Storybook or a dev environment, flip the flag and ensure panels behave in “legacy” style (no layer controls, manual z-order).
3. **Manual QA:** Verify popups, keyboard shortcuts, and drag/drop across both modes.

## Future Considerations
- If the project no longer needs the legacy single-layer mode, remove the flag entirely and simplify the code paths.
- Consider a remote-config driven mechanism (e.g., environment JSON) if multiple flags need to be toggled at runtime.

## Next Steps
1. Update `feature-flags.ts` with new keys and defaults.
2. Refactor LayerManager hook to rely on the unified flag.
3. Apply the new gating in panels, overlays, and keyboard shortcuts.
4. Add tests and documentation describing how to toggle the flag.
5. Review with stakeholders before merging to confirm legacy mode is still required or can be fully retired.
