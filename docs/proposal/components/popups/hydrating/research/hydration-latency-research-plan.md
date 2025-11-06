# Popup Overlay Hydration Latency – Research Plan

## Goals
- Understand why workspace hydration sometimes completes almost instantly but occasionally stalls long enough to block overlay panning.
- Quantify the database/API work triggered during hydration and identify the heaviest contributors.
- Confirm the relationship between the hydration lock (`isWorkspaceLayoutLoading`) and perceived canvas sluggishness while dragging.
- Produce evidence (logs, traces, timings) to guide fixes without introducing regressions.

## Reproduction Matrix
| Scenario | Steps | Expected Outcome | Observed Issue |
| --- | --- | --- | --- |
| Fast hydration | 1. Start on Workspace 3 with only the root popup open.\n2. Switch to Workspace 1.\n3. Switch back to Workspace 3. | `workspace_hydration_*` logs appear in a single short burst (<1 s). Overlay unlocks immediately. | Works today; use as baseline. |
| Slow hydration with nested popup | 1. In Workspace 3, open folder “g” so a child popup renders.\n2. Switch to another workspace.\n3. Return to Workspace 3. | Hydration should still finish quickly. | Banner lingers; canvas drag ignored until hydration ends. |
| Drag during hydration | 1. Trigger slow hydration scenario.\n2. While the banner is visible, attempt to pan the overlay. | Drag should start or queue. | `handlePointerDown` exits early due to `isLocked`; panning never engages. |

For each scenario capture:
- `docker exec annotation_postgres psql … SELECT` output for `workspace_hydration_started/finished/error` durations.
- Chrome Performance trace (15 s window) focusing on network waterfall and main-thread tasks.
- Network tab export, filtered to `/api/overlay/layout` and `/api/items*`.

## Code Paths to Audit
1. `components/annotation-app.tsx`
   - Hydration effect (~lines 1360–1445): sets `isWorkspaceLayoutLoading`, calls `overlayAdapter.loadLayout`, and logs telemetry.
   - `applyOverlayLayout` (~lines 1090–1230): rehydrates popups and issues per-popup `fetch` calls (folder details, ancestor color chain, child listing). Hypothesis: these sequential fetches amplify latency when more popups are visible.
   - Persistence guard (~lines 1466–1514): verify interaction between `overlayPanning`, `needsSaveAfterInteraction`, and hydration.
2. `components/canvas/popup-overlay.tsx`
   - Pointer handlers (`handlePointerDown` at ~2234): confirm `isLocked` guard short-circuits panning while hydration runs.
   - `handlePointerMove` / `handlePointerEnd`: ensure no extra work happens during drag.
3. `lib/adapters/overlay-layout-adapter.ts`
   - `loadLayout`: check response size, error handling, and whether additional retries occur.
4. `lib/workspaces/overlay-hydration.ts`
   - Inspect transform-building logic for potential synchronous heavy work (large maps, transforms).
5. API routes under `app/api/overlay` (GET layout, optional metadata endpoints) to understand server latency contributions.

## Data Collection Tasks
- Instrument hydration durations in the UI (timer around `adapter.loadLayout` and the per-popup decoration loop) gated by an env flag; log to Postgres for a few runs.
- Measure time per network request in DevTools for both small and nested popup cases.
- Capture CPU profiles while hydration runs to see whether serialization/deserialization on the client dominates.

## Hypotheses to Validate
1. **Sequential Fetch Waterfall**: Per-popup folder/ancestor/children fetches make hydration duration roughly proportional to popup count. Cache or parallelize them to reduce the lock window.
2. **Lock Scope Too Broad**: `isWorkspaceLayoutLoading` stays true until decoration finishes; we could unlock earlier (after the base layout is applied) while running decoration async.
3. **Redundant Rehydration Triggers**: Switching back to a workspace with unchanged layout might be re-running hydration because `layoutLoadedRef` is reset unnecessarily. Investigate whether we can reuse cached payloads or check revision hashes first.

## Deliverables
- Profiling artefacts (SQL dumps, DevTools traces) stored alongside this plan.
- Table summarizing hydration durations with/without nested popups.
- Recommendation doc outlining the most effective mitigation (e.g., lazy folder fetch, shared cache, or unlock-after-base-load).

## Next Steps
1. Capture baseline timings today (fast vs slow scenarios) and attach results.
2. Prototype instrumentation patch (feature-flagged) to log per-popup fetch timings.
3. Evaluate feasibility of deferring folder/ancestor fetches until after the overlay unlocks.
4. Prepare proposal on restructuring hydration to avoid long-lived lock, referencing the collected data.
