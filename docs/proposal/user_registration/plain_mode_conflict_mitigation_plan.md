# Plain Mode Autosave Conflict Mitigation Plan

## Goal
Implement the sequential save queue and supporting safeguards to eliminate single-tab “stale document save” conflicts while keeping plain mode responsive and compatible with future multi-user support.

## Scope
- Client-only changes (no schema adjustments) inside:
  - `lib/providers/plain-offline-provider.ts`
  - `components/canvas/tiptap-editor-plain.tsx`
  - Optional: `lib/adapters/web-postgres-offline-adapter.ts` (instrumentation only)
- Non-destructive instrumentation and tests under `__tests__/plain-mode`.
- Preserve `document_saves` workspace uniqueness (migration 022).

## Workstream Overview
1. **Instrumentation (Phase 0)**
   - Guard debug logging with `NEXT_PUBLIC_DEBUG_AUTOSAVE`.
   - Capture timestamps, cache keys, base/current versions, and queue depth.
   - Instrument adapter saves to confirm one in-flight request per document after queue rollout.

2. **Sequential Save Queue (Phase 1)** *(implemented 2025‑05‑06)*
   - `PlainOfflineProvider` now serializes saves per `(noteId,panelId)` via a guarded promise chain (`saveQueues`, `saveQueueDepth`).
   - Each queued task re-checks the current version before hitting the adapter and skips if the provider already knows about a newer revision.
   - A 7 s timeout logs a warning if a request stalls; queue depth is exposed for future backoff logic.
   - Autosave remains optimistic; instrumentation is gated by `NEXT_PUBLIC_DEBUG_AUTOSAVE` for tracing.

3. **Conflict Refresh Barrier (Phase 2)**
   - After `refreshDocumentFromRemote`, emit `document:refresh-complete` with `noteId`, `panelId`, `version`.
   - Update `TiptapEditorPlain` to pause autosave while `refreshPendingRef` is true; resume on event or fallback timeout.

4. **Adaptive Debounce (Optional Phase 3)**
   - Track queue length (available from instrumentation) to increase debounce delay when `queueLength > 0` (e.g., 300 → 600 → 900 ms capped at 1200 ms).
   - Reset delay once queue clears.

5. **Testing & Validation (Phase 4)**
   - Extend `__tests__/plain-mode/plain-provider-conflict.test.ts` to ensure saves are serialized and refresh barrier triggers.
   - Add Playwright scenario covering rapid note switches under throttled network.
   - Manual QA: note switching, annotation edits, offline mode toggle.

## Rollout Strategy
- Ship behind feature flag `NEXT_PUBLIC_ENABLE_SEQUENTIAL_SAVES` to allow staged rollout.
- Enable instrumentation in development builds, disable in production unless flag is active.
- Monitor logs for queue timeout warnings and remaining 409s; adjust debounce/backoff if needed.

## Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| Queue deadlock from hung request | Timeout + catch reset; surface toast if triggered |
| Increased save latency noticed by users | Maintain optimistic UI; show subtle “Saving…” indicator when queue non-empty |
| Annotation or batching regressions | Keep plugin registration untouched; ensure batch manager honors queue by enqueueing entire batch as one task |
| Missed refresh-complete event | Add 5 s fallback to re-enable autosave even if event fails |

## Deliverables
- Updated TypeScript files implementing queue + barrier.
- Debug logging toggle documented in README or Dev Docs.
- New/updated unit and Playwright tests.
- Post-change measurements: autosave latency timeline, conflict count (expect zero in single-tab scenarios).

## Timeline (suggested)
1. Phase 0 instrumentation: 0.5 day
2. Phase 1 queue implementation + tests: 1 day
3. Phase 2 barrier + tests: 0.5 day
4. Optional Phase 3 debounce/backoff: 0.5 day
5. Phase 4 validation & cleanup: 0.5 day

## Open Questions
- Should the queue apply only when `enableBatching` is false, or always? (Preference: always, with batching enqueuing as single task.)
- Do we need UI feedback for “Save queued”? (Recommend small status indicator if queue length > 1.)
- How do we expose instrumentation safely in production? (Probably via debug flag or internal build.)

## Next Step
Kick off Phase 0 instrumentation to confirm baseline conflict timing and validate that queue adoption removes overlapping saves.
