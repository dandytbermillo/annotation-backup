---

## Research & Validation Plan

### Goal
Verify that this hardening plan:
- Eliminates the ghost panel regression in all supported browsers.
- Produces a workspace architecture that is deterministic across refreshes, tabs, and offline/online transitions.
- Avoids introducing new performance or UX regressions.

### 1. Literature & Prior Art Review
- Collect references on cache versioning and workspace persistence (Azure architecture guides, VS Code Settings Sync, Figma/Notion postmortems if available).
- Summarize recommended patterns (single authoritative store, version handshakes, TTL policies) and map them to each phase of this plan.
- Document pros/cons of CRDT migration vs versioned Postgres.

### 2. Current-State Baseline
- Reproduce ghost panel behavior on main branch (two browsers, close panel in one, reload other).
- Record metrics: time to load workspace, frequency of ghost panel reproduction, existing telemetry counts (if any).
- Audit data stores (Postgres, localStorage, IndexedDB) before/after close to understand current divergence.

### 3. Proof-of-Concept Implementation
- Implement Phase 1 (version column + transactional closes + cache invalidation) on a feature branch.
- Instrument hydration to log cache vs server version decisions.
- Keep feature flag to toggle new behavior.

### 4. Validation Matrix
| Scenario | Steps | Expected Result |
|----------|-------|-----------------|
| Plain-mode reload after close | Close panel, reload same browser | Panel stays closed, snapshot rewritten |
| Cross-browser sync | Close in Browser A, reload Browser B | B fetches server version, panel stays closed |
| Offline close + reconnect | Close while offline (queue persists), reconnect | Queue applies with correct version; no ghost |
| Snapshot older than TTL | Manually age snapshot (> TTL), reload | Snapshot discarded, server load used |
| Concurrent reopen | A closes panel, B reopens before A reloads | Version increments captured; reload in either reflects latest server state |

### 5. Performance & Load Testing
- Measure load time with and without local snapshot after version check.
- Stress test with many panels and frequent version increments to ensure DB costs are acceptable.
- Validate offline queue replay throughput after adding version checks.

### 6. Telemetry & Monitoring
- Define metrics: cache_hits, cache_discards, version_mismatch_events.
- Set alert thresholds for abnormal mismatch rates.

### 7. Rollout Plan
- Stage in internal/staging environment with feature flag.
- Run QA scripts for all scenarios above across Chrome/Firefox/Safari.
- Roll out gradually; monitor telemetry dashboard for anomalies.

### 8. Success Criteria
- Zero reproductions of ghost panel in regression suite and manual QA.
- Cache discard rate within expected bounds (initial spike during rollout acceptable, stabilizes afterward).
- No user-facing regressions (load time within acceptable variance, no repeated prompts).
- Monitoring shows version drift resolved or within tolerable thresholds.

### 9. Documentation
- Update architectural docs to describe new version handshake.
- Publish quick reference for developers (how to bump version, how cache invalidation works).
- Add troubleshooting guide for ops (how to reset versions, locate stale snapshots).

### 10. Decision Checkpoints
- After Phase 1 implementation + validation → decide on Phase 2 (keep/drop snapshot/queue).
- After Phase 3 → evaluate whether CRDT migration is still necessary or deferred.

By following this research plan, we can empirically confirm that the hardening steps remove the ghost panel issue and deliver a maintainable, production-grade workspace architecture.

---

### Affected Files (Current Targets)
- `components/annotation-canvas-modern.tsx`
- `components/canvas/canvas-context.tsx`
- `components/canvas/canvas-workspace-context.tsx`
- `lib/hooks/use-canvas-hydration.ts`
- `lib/hooks/use-panel-persistence.ts`
- `lib/canvas/canvas-offline-queue.ts`
- `app/api/canvas/layout/[noteId]/route.ts`
- `app/api/canvas/workspace/route.ts`
- `scripts/run-migrations.js` (migration wiring)
- `migrations/0xx_add_canvas_workspace_version.*` (placeholder included)

Copies of the current revisions are stored in `plan/worksspace_architecture/affected_files/` (flattened filenames such as `annotation-canvas-modern.tsx`, `app_api_canvas_workspace_route.ts`, etc.) for quick diffing during validation.
