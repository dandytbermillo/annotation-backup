# Plan: Camera & Panel Persistence Hardening (Phase 1.5)

**Date**: 2025-10-15  
**Owner**: Canvas Platform Team  
**Status**: Draft (ready for review)

---

## Context
Recent fixes restored camera persistence and main-panel seeding, but the remediation surfaced several adjacent gaps:
- No automated coverage for “first reload” behavior.
- Hard-coded dimension logic exists outside the canvas seeding path.
- Camera persistence still uses a shared row and synchronous network call.
- Offline support and observability for workspace seeding are thin.

Before Phase 2 (full unified canvas refactor), we need an intermediate hardening pass to protect the restored behavior and prepare for per-user state.

---

## Objectives
1. Lock in deterministic reload behavior with automated tests.
2. Provide reusable utilities for accurate panel sizing and seeding.
3. Add optional per-user camera storage without breaking existing shared mode.
4. Guarantee viewport state survives offline reloads.
5. Emit telemetry when main-panel seeding occurs to catch regressions in CI/production.

---

## Deliverables
| ID | Deliverable | Description |
| --- | --- | --- |
| D1 | Playwright regression suite | E2E scenarios covering new-note reload (dragged vs untouched), branch seeding, and title persistence. |
| D2 | Panel dimension helper | Utility (e.g., `measurePanelBounds(panelId)`) exposed via Canvas context or persistence hook; refactor seeding to consume it. |
| D3 | Per-user camera option | Extend `/api/canvas/camera/:noteId` + hydration to honor `userId` query param; add client support gated behind feature flag. |
| D4 | Offline queue integration | Route camera snapshot writes through `canvasOfflineQueue`; add retry/backoff logging. |
| D5 | Seeding telemetry | Single log event (`workspace_seeding_main_panel`) with noteId, reason, dimensions; alert if frequency exceeds expectation. |

---

## Work Breakdown & Checks

### D1. Regression Tests
- [ ] Scaffold Playwright test utilities for canvas interactions (drag, reload, minimap assertions).
- [ ] Test: create note, do not drag, reload → panel remains centered (assert via DOM + minimap bounding box).
- [ ] Test: create note, drag main panel, reload → coordinates match saved snapshot.
- [ ] Test: create branch panel, reload → both panels stay aligned.
- [ ] Wire tests into CI (skip locally if Playwright not installed).

### D2. Panel Dimension Helper
- [ ] Add helper in `lib/canvas/panel-metrics.ts` (or similar) with fallbacks (DOM → store → defaults).
- [ ] Refactor `components/annotation-canvas-modern.tsx` seeding to use helper.
- [ ] Audit other panel creation paths (`handleCreatePanel`, branch modals) for repeated size guesses; consolidate.
- [ ] Document API in `docs/proposal/canvas_state_persistence/INTEGRATION_GUIDE.md`.

### D3. Per-user Camera Option
- [ ] Update API route: accept `x-user-id` header or query param; store in `canvas_camera_state`.
- [ ] Migration: add composite index `(note_id, user_id)` if missing.
- [ ] Extend `useCameraPersistence` to accept optional `userId`; gate behind env flag.
- [ ] Hydration: prefer per-user record; fall back to shared row; emit debug logs for fallback.
- [ ] Manual validation with two simulated users.

### D4. Offline Queue Integration
- [ ] Create queue task `camera_snapshot` with payload `{ noteId, camera, userId? }`.
- [ ] Update snapshot restore path to enqueue rather than `fetch` directly.
- [ ] Add replay handler that flushes queued snapshots on reconnect.
- [ ] Smoke test by toggling `navigator.onLine` and reloading.

### D5. Seeding Telemetry
- [ ] Add `debugLog` event `workspace_main_panel_seeded` (noteId, seedReason, dimensions, viewport).
- [ ] Add counter to detect >1 trigger per note within 24h.
- [ ] Update monitoring dashboard (or docs) with alert condition.

---

## Acceptance Criteria
- Automated tests fail if the main or branch panels drift on reload.
- No hard-coded panel sizes remain; helper returns accurate measurements (verified via unit tests).
- Feature flag `NEXT_PUBLIC_CANVAS_CAMERA_SCOPE=per-user` enables per-user storage; default shared mode unchanged.
- Offline reload preserves camera snapshot (verified via manual QA script).
- Telemetry dashboard displays seeding events with expected count (<2 per note/day).

---

## Timeline (Indicative)
| Week | Focus |
| --- | --- |
| Week 1 | D1 regression harness, D2 helper implementation |
| Week 2 | D3 API + client support (behind flag) |
| Week 3 | D4 offline queue integration, QA |
| Week 4 | D5 telemetry + docs updates, handoff to Phase 2 planning |

---

## Dependencies & Risks
- Requires Playwright infrastructure in CI (ensure runners have required deps).
- Per-user camera mode depends on upcoming auth context to provide deterministic user IDs.
- Offline queue enhancements should coordinate with any parallel storage refactors (avoid duplicate queue schemas).

---

## Follow-up Links
- Remediation summary: `docs/proposal/canvas_state_persistence/next steps/2025-10-15-canvas-camera-restoration.md`
- Workspace API plan: `docs/proposal/canvas_state_persistence/plan/2025-10-14-workspace-api-implementation.md`
- Phase 2 overview: `docs/proposal/canvas_state_persistence/phase2-unified-canvas-plan.md`

