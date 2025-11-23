# Component Snapshot Persistence – Workspace Parity Fix

## Context
- Scope: `NOTE_WORKSPACES_V2` overlay parity plan – Steps 2 & 4 (per-workspace datastore isolation + capture sequencing).
- Goal: ensure every workspace capture serializes non-note components (calculator, timer, etc.) with correct types so switching/reload behaves like a browser tab.
- Anti-pattern check: no new context methods/hooks were introduced; consumer/provider contracts are unchanged, so the isolation/reactivity guardrails remain satisfied.

## Implementation Highlights
1. **Seed the workspace stores before persistence runs**  
   - File: `lib/hooks/annotation/use-panel-creation-handler.ts`.  
   - When a panel is created we now synthesize a normalized record (position, dimensions, metadata) directly into the per-workspace DataStore + branches map and immediately emit `markPanelPersistenceReady`.  
   - Result: `waitForPanelSnapshotReadiness` no longer times out—captures see the newly spawned panel on the first pass instead of waiting 2.5 s for the async save loop.

2. **Resolve pending state inside panel persistence hooks**  
   - File: `lib/hooks/use-panel-persistence.ts`.  
   - `persistPanelCreate` / `persistPanelUpdate` now mark themselves `ready` as soon as the local transaction applies (before the network call).  
   - Guarantees every `panel_pending` log has a matching `panel_ready`, keeping the capture/rehydrate pipeline unblocked even if `/api/canvas` writes are slow or retried offline.

3. **Keep component metadata in the per-workspace LayerManager**  
   - File: `components/canvas/component-panel.tsx`.  
   - On mount/update we reconcile the component node’s `metadata.componentType` with the actual widget type.  
   - Combined with the existing per-workspace LayerManager provider, `build_payload_components` now receives authoritative component records instead of the shared “component” fallback, so calculators no longer hydrate as “Unknown component type”.

## Verification Steps
1. `npm run type-check` (already green).  
2. Manual workspace test:  
   - Create a calculator + at least one additional panel in the default workspace.  
   - Switch to a different workspace immediately (<1 s), then back.  
   - Confirm non-main panels and the calculator reappear instantly with the correct UI.  
3. Log review:  
   - `tail -f logs/debug.log` while reproducing.  
   - Expect to see `panel_pending` followed by `panel_ready` for each panel ID before `snapshot_capture_start`.  
   - `snapshot_cached_from_payload` entries should show `componentCount >= 1` and `componentTypes` including `calculator`.

## Follow-up / Rollout Notes
- No new feature flags. Changes ride behind `NOTE_WORKSPACES_V2`, matching the existing plan.  
- If additional component types arrive, ensure their panels call `handleAddComponent` (which now registers via the per-workspace LayerManager) so no further plumbing is required.  
- Keep the enhanced logging until QA confirms parity across rapid switches + reloads. Remove once the saturation metrics show zero drops for a full soak window.
