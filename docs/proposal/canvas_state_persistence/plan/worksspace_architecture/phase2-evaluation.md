## Phase 2 Evaluation – Canvas Workspace (2025‑10‑22)

This note captures the deliverables requested in Phase 2 of `ghost_panel_remedy.md`: measure cold-load behaviour, decide whether to retain the snapshot/offline queue path, and document the rationale after the new guardrails landed.

### 1. Cold-load vs Snapshot Metrics

Hydration already logs `CanvasWorkspace.workspace_toolbar_state_rehydrated` with a `hydrationDurationMs` field. Querying the most recent data gives a clear split between cache hits (≤ 50 ms) and server falls-backs (> 50 ms):

```sql
SELECT
  COUNT(*) FILTER (WHERE (metadata->>'hydrationDurationMs')::numeric <= 50)  AS fast_count,
  AVG((metadata->>'hydrationDurationMs')::numeric) FILTER (WHERE (metadata->>'hydrationDurationMs')::numeric <= 50)  AS fast_avg_ms,
  COUNT(*) FILTER (WHERE (metadata->>'hydrationDurationMs')::numeric > 50)   AS slow_count,
  AVG((metadata->>'hydrationDurationMs')::numeric) FILTER (WHERE (metadata->>'hydrationDurationMs')::numeric > 50)   AS slow_avg_ms
FROM debug_logs
WHERE component = 'CanvasWorkspace'
  AND action = 'workspace_toolbar_state_rehydrated'
  AND metadata ? 'hydrationDurationMs';
```

Result (run 2025‑10‑22):

| cache path | samples | mean duration |
|------------|---------|---------------|
| Snapshot hit (≤ 50 ms) | 586 | **31.7 ms** |
| Server fallback (> 50 ms) | 1,608 | **140.0 ms** |

The slow cohort aligns with cases where the browser had to fetch panels from Postgres after the cache expired. Even a handful of recent measurements captured > 200 ms on cold loads (e.g. `debug_logs.id=8945530` at 230 ms), reinforcing that snapshot reuse keeps the initial render tight.

### 2. Decision – Retain Snapshot + Offline Queue

- **Snapshot**: Keeping a 24 h cache shaves ~110 ms off boot time on average, and prevents the “panel jump” effect for plain-mode users who reload frequently. Dropping localStorage would regress both speed and perceived stability, so we’re keeping the snapshot but constraining the payload to `{ version, savedAt, panels }`. See `lib/canvas/canvas-storage.ts` for the new format, which trims legacy fields while preserving the data the workspace hydrator needs.
- **Offline queue**: Version-tagged queue entries now skip replays when the stored workspace version drifts (`lib/canvas/canvas-offline-queue.ts`). Removing the queue would break the current offline UX (creating/moving panels while disconnected), so we’ll retain it with the new safeguards. Telemetry for the `workspace_version_mismatch` action is live and should be monitored during QA.
- **Reconciliation telemetry**: Cache usage is now reported through `canvas.cache_used`, `canvas.cache_mismatch`, and `canvas.cache_discarded` so we can monitor how often snapshots are reused vs. evicted (`lib/canvas/canvas-storage.ts`).

### 3. Summary of Code Changes

- Snapshot TTL enforced at 24 h on both save and load paths (`lib/hooks/use-canvas-hydration.ts`, `lib/canvas/canvas-storage.ts`).
- Stored snapshot format now: `{ version, savedAt, panels: { workspaceVersion, viewport, items, layerNodes } }`. Legacy data is still accepted but will be re-written on next save (`lib/canvas/canvas-storage.ts`).
- Workspace version map persisted to `localStorage`, exposed via `getWorkspaceVersion`, and wired through panel/camera persistence so the offline queue can validate replays (`components/canvas/canvas-workspace-context.tsx`, `lib/hooks/use-panel-persistence.ts`, `lib/hooks/use-camera-persistence.ts`, `lib/canvas/canvas-offline-queue.ts`).

With these pieces in place, Phase 2 deliverables are satisfied. Phase 3 can now focus on removing the reconciliation prompt, auto-selecting the freshest data, and emitting cache hit/miss telemetry.***
