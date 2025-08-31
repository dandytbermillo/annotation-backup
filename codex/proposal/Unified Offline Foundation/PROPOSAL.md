# Unified Offline Foundation (Option A, PostgreSQL‑Only)

Date: 2025‑09‑01
Owner: Offline/Sync Working Group
Status: Proposal (for review)

## Executive Summary
- Goal: Elevate the current “good foundation” to a robust, user‑trustworthy offline‑first experience under Option A (PostgreSQL‑only; no Yjs, no IndexedDB).
- Strategy: Add three critical capabilities — Smart Network Layer, Service‑Worker API caching with write replay, and a Conflict Resolution UI — while aligning the server queue worker and keeping all storage/PostgreSQL guarantees intact.
- Outcomes: Reliable offline reads, resilient write replay, transparent conflict handling, measurable performance, and predictable UX across Web and Electron.

## What We Agree With (from LLM findings)
- Smart connectivity is required: navigator.onLine alone is unreliable; we need active reachability, quality metrics, and a circuit breaker.
- Conflict UI is critical: detection exists, but users need a guided resolution flow (diff/merge/force options).
- PWA + Service Worker helps: Cache GETs for fast offline reads; replay queued writes when back online; show progress.

## Clarifications
- Queue storage: Core offline queue is PostgreSQL (`offline_queue`). localStorage is a fallback only in some adapters and should not be used for persistence in production.
- Conflict groundwork: APIs for versions/compare exist; we need to connect them to a full UX with three‑way merge or “choose mine/theirs” fallbacks.

## Goals and Non‑Goals
- Goals:
  - Reliable offline reads via HTTP response caching (Cache Storage), not IndexedDB.
  - Robust write replay via the existing PostgreSQL queue (server/Electron workers).
  - Clear user feedback (quality, offline state, queue depth, sync progress).
  - Conflict resolution flow that is simple and unblocks users safely.
- Non‑Goals:
  - No Yjs or CRDT collaboration (belongs to Option B).
  - No IndexedDB document persistence (Option A forbids it).

## Architecture Overview
- Client:
  - Smart Network Layer: active reachability to `/api/health`, rolling RTT, circuit breaker for write/replay attempts, quality states (Good/Degraded/Offline).
  - Service Worker (SW): cache GETs (documents/notes/panels/search) with SW strategies; queue write requests for replay via Background Sync where available; visible “Sync Now” fallback.
  - Conflict UI: surface 409 responses; present compare/diff/merge; support force save with explicit warnings.
- Server:
  - Queue Worker: dual‑mode flush endpoint retained (body‑ops + DB drain). DB drain uses SKIP LOCKED, idempotency, and deletes only processed IDs; dead‑letter for exceeded retries.
  - Search/FTS and versions endpoints unchanged; ensure auth/validation.
- Storage:
  - PostgreSQL as the only persistence source of truth.
  - Cache Storage for HTTP responses (non‑sensitive data only).

## Components and Technical Design
- Smart Network Layer
  - Reachability: HEAD/GET `/api/health` with 1–2s timeout; exponential backoff; rolling averages for RTT and success rate.
  - Circuit breaker: open after N consecutive failures; half‑open probes before resuming; pause replay while open.
  - UI exposure: global indicator (Good/Degraded/Offline), queue depth, last sync timestamp.
  - Telemetry: capture attempt counts, RTT, success/failure, breaker state.

- Service Worker (SW) Caching and Write Replay
  - GET caching (Cache Storage):
    - Documents: `/api/postgres-offline/documents/:noteId/:panelId`
    - Notes: `/api/postgres-offline/notes[/:id]`
    - Panels/Branches/Search as safe/needed.
    - Strategy: stale‑while‑revalidate with versioned cache names; TTL + LRU policy to bound size.
  - Write replay:
    - Queue POST/PUT/DELETE when offline or breaker open; replay with Background Sync if supported; otherwise “Sync Now” button.
    - Integrity: use server queue (idempotency_key enforced by DB).
  - Security:
    - Auth‑aware cache keys (include user scope); do not cache sensitive/private endpoints by default.
    - Clear cache on logout or scope changes.

- Conflict Resolution UI
  - Trigger: on 409 from a save/flush; pass through base_version/base_hash from client envelope.
  - Data: fetch current and base versions via `/api/versions/[noteId]/[panelId]` and `/api/versions/compare`.
  - UX:
    - Show latest vs. user’s content; human‑readable diff.
    - Actions: “Keep Mine”, “Use Latest”, “Merge” (simple three‑way merge where feasible), “Save Anyway (Force)” with warning.
  - Telemetry: record outcomes (merge/force/abort) and retries; add guardrails for repeated conflicts.

- Queue/Worker Cohesion (Server/Electron)
  - Dual‑mode flush: preserve body‑ops for compatibility; add robust DB drain (priority, TTL, dependencies, dead‑letter, processed‑IDs deletion).
  - SQL safety: whitelist tables; parameterized queries; never interpolate table names.
  - Observability: minimal counters (processed/failed/expired) and dead‑letter insights exposed via existing endpoints.

- Security and Compliance
  - Auth guards: consistent across import/export/flush; optional admin key in dev.
  - Input validation: enforce types/schemas (server side).
  - Caching rules: never cache sensitive endpoints; scope caches per user; wipe on logout.

## Parameters (Defaults)
- Cache budgets
  - Documents: 50 MB total Cache Storage budget
  - Lists/Search: 15 MB budget (separate cache namespace)
- TTLs
  - Documents: 7 days
  - Lists/Search: 24 hours
  - Health/Status: 10 minutes (client-side memoization only)
- Circuit breaker
  - Open after 3 consecutive failures
  - Half-open probe after 10 seconds
  - Backoff: 1s → 2s → 4s → 8s (cap 30s)
  - Close after 2 consecutive successes
- Batch replay limits
  - Max 25 operations per replay run
  - Respect server 429/5xx with backoff before next run
- Fuzzy search threshold
  - Default 0.45; clamp to [0, 1]; allow `?similarity=` override

## Phased Plan (Option A Compliant)
- Phase 1 (≈1 week): Connectivity Foundation
  - Implement reachability, RTT, and circuit breaker.
  - Add global UI indicator and queue stats.
  - Acceptance: connectivity state stable; breaker avoids thrash; UI reflects state changes; tests simulate online/offline.

- Phase 2 (≈1.5–2 weeks): SW Caching + Write Replay
  - Cache GET endpoints (documents/notes/panels) with SW; define TTL/LRU; add “Sync Now” fallback.
  - Replay queued writes on reconnect; reflect progress and errors in UI.
  - Acceptance: open recent docs offline; edits offline enqueue and flush on reconnect without data loss; dead‑letter path visible.

- Phase 3 (≈1.5–2 weeks): Conflict Resolution UX
  - Integrate 409 handling to a guided dialog; wire `/versions` and `/compare`; support simple merges and force‑save.
  - Acceptance: conflicts are resolvable end‑to‑end; user never stuck; audit logs available.

## Acceptance Criteria (Per Phase)
- Connectivity: measured RTT and breaker state exposed; breaker halts replay; resumes after probe success.
- Caching: cache hits during offline; SW revalidates on return; cache size bounded; no sensitive data cached.
- Replay: queued writes succeed on reconnect; progress visible; dead‑letter operations are requeueable/discardable via UI.
- Conflicts: user can choose mine/theirs/merge/force; saves succeed post‑resolution.

## Test Plan
- Unit: network layer (backoff, breaker), cache keys, conflict helpers.
- API/Integration: dual‑mode flush, import/export with idempotency, versions/compare, search with trigram threshold.
- HTML dashboard: extend to verify offline cache hits and conflict flows.
- Node suite: add cases for breaker and SW caching behavior (behind a mock/fetch shim).
- E2E: Playwright with SW enabled (Chromium/WebKit/Firefox); assertions for cache hits, replay success, conflict dialog flows.
- Manual: Airplane mode tests; flaky network simulation; cache invalidation and logout behavior.

## Risks and Mitigations
- Background Sync support gaps: provide “Sync Now” and periodic retry job.
- iOS PWA limitations: optimize for Safari constraints; ensure manual flows work.
- Caching privacy: whitelist only safe GET endpoints; scope caches per user.
- Large datasets: rely on Electron local DB for truly large offline sets; on Web, limit cache via TTL/LRU.

## Security, Privacy, and Allowlist
- Auth‑aware cache keys (user/tenant scoped); clear caches on logout or scope changes.
- Never cache sensitive endpoints (e.g., admin, exports with payloads, auth tokens).
- Explicit allowlist for SW caching (initial):
  - `/api/postgres-offline/documents/*`
  - `/api/postgres-offline/notes*`
  - `/api/postgres-offline/panels*`
  - `/api/search?*` (only GET, sanitized params)
- Server input validation for all write endpoints (schema/type checks).

## Rollout and Flags
- Feature flags: `offline.swCaching`, `offline.conflictUI`, `offline.circuitBreaker`.
- Progressive: enable Phase 1 in dev → Phase 2 behind flag → Phase 3 after review.
- Docs: update README and troubleshooting; add user‑facing “Working Offline” guide.

## Metrics and SLOs
- Connectivity: p95 RTT while online; breaker open time < 5% of session time (excluding true outages).
- Caching: offline open success rate > 95% for recent docs; cache hit ratio target > 60% for repeat opens; cache size within budget; eviction counts tracked.
- Replay: success rate > 99% within 2 retries; dead‑letter rate < 0.5% of operations; average ops per replay ≤ 25; backoff compliance.
- Conflicts: resolution success > 95%; force‑save < 10% of conflicts; repeated conflict loops < 2%.

## Platform Constraints and Fallbacks
- Background Sync not universally available (notably iOS): always provide manual “Sync Now” and timed retry.
- Service Worker disabled environments: degrade to queue‑only offline (no cached reads) with clear UI messaging.

## Implementation Checklists (Per Phase)

Phase 1 – Connectivity Foundation
- Add reachability probe to `/api/health` with 1–2s timeout and exponential backoff.
- Implement circuit breaker: open(3 fails), half‑open(10s), close(2 successes).
- Expose network quality state, queue depth, last sync time in UI.
- Telemetry: log RTT, breaker state changes, probe outcomes.

Phase 2 – SW Caching + Write Replay
- Register SW with versioned cache namespaces (docs, lists/search).
- Implement stale‑while‑revalidate for GETs; enforce TTLs and LRU within budgets (50MB/15MB).
- Intercept write requests; enqueue when offline/breaker open; implement Background Sync + “Sync Now”.
- Respect idempotency keys; backoff on 429/5xx; replay ≤ 25 ops/run.
- Auth‑aware cache keys; clear caches on logout/tenant change.

Phase 3 – Conflict Resolution UX
- On 409, collect base/current via `/versions` and `/compare`.
- Render diff; implement actions: Keep Mine, Use Latest, Merge (simple), Force Save.
- Wire “force” to server with explicit confirmation; log outcomes and retries.
- E2E tests for full resolve loop; guardrails for repeat conflicts.

## Option A Compliance
- Storage: PostgreSQL only; no IndexedDB persistence.
- SW caches HTTP responses only; data-of-record remains in PostgreSQL.
- Smooth future Option B transition: versions/compare and conflict envelopes align with Yjs adoption later.
