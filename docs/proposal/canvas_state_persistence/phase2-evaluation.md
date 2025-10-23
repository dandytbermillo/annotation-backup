# Phase 2 – Cache Simplification Evaluation

**Date:** 2025-10-22  
**Owner:** Canvas Platform Team  
**Scope:** Plan `docs/proposal/canvas_state_persistence/plan/worksspace_architecture/ghost_panel_remedy.md`, Phase 2

---

## Objectives Recap
- Reduce the canvas snapshot footprint to `{ version, savedAt, panels }`.
- Enforce a 24 hour TTL and workspace-version guard so stale snapshots never hydrate.
- Persist the latest workspace versions to the browser cache for offline hydrators.
- Ensure queued offline writes carry the originating workspace version and abort safely when the live version advances.
- Capture telemetry for cache hits, mismatches, and discards to track cache health.

## Implementation Summary
| Item | Status | Notes |
| --- | --- | --- |
| Snapshot payload trimmed | ✅ | `saveStateToStorage()` now writes `{ version, savedAt, panels }` (see `lib/canvas/canvas-storage.ts:394-466`). |
| TTL + workspace version guard | ✅ | `loadStateFromStorage()` enforces the 24 h TTL and discards mismatched snapshots (`lib/canvas/canvas-storage.ts:240-360`). |
| Workspace version map | ✅ | `CanvasWorkspaceProvider` persists `canvas_workspace_versions` to localStorage (`components/canvas/canvas-workspace-context.tsx:120-156`). |
| Offline queue handshake | ✅ | Every queued write stores `workspaceVersion` and validation runs before replay (`lib/canvas/canvas-offline-queue.ts:83-122, 273-298`). |
| Telemetry coverage | ✅ | `CanvasCache` emits `canvas.cache_used`, `canvas.cache_mismatch`, and `canvas.cache_discarded`; verification script confirms live events (`scripts/verify-phase2-telemetry.js`). |

## Observed Metrics (last 30 days)
| Event | Count | First Seen | Last Seen |
| --- | --- | --- | --- |
| `canvas.cache_used` | 163 | 2025-10-22 03:11:20 | 2025-10-22 20:42:51 |
| `canvas.cache_mismatch` | 1 | 2025-10-22 03:11:26 | 2025-10-22 03:11:26 |
| `canvas.cache_discarded` | 2 | 2025-10-22 03:11:26 | 2025-10-22 03:43:07 |

**Interpretation**
- Cache hits dominate, indicating the new snapshot layout is being reused successfully.
- A single mismatch + discard occurred after a scripted conflict test—telemetry confirms stale snapshots are being rejected.
- Discards for “invalid_structure” or “expired” remain rare, which is expected with the tighter TTL.

## Decision & Follow-ups
- ✅ Retain the simplified snapshot schema and 24 h TTL in production.
- ✅ Keep the offline queue version guard enabled; it is required for Phase 3 conflict detection.
- ⚠️ Continue to monitor `canvas.cache_*` telemetry via `npm run verify:phase2` during releases.
- ✅ No rollback required; the new behavior is stable.

## Verification Checklist
- `npm test -- workspace-version-conflict.test.ts` (Phase 3 automation) – Pass.
- `npm run verify:phase2` – Reports the metrics above.
- Manual smoke (drag → persist → reload) – No regressions observed.

Phase 2 is **complete**. Phase 3 telemetry and conflict handling are now the primary guardrails for ongoing work on the ghost-panel remedy.

