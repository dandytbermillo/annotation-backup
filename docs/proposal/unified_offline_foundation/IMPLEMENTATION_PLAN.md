# Implementation Plan — Unified Offline Foundation (Option A)

Context
- Proposal: `codex/proposal/Unified Offline Foundation/PROPOSAL.md`
- Mode: Option A (PostgreSQL-only, no IndexedDB, no Yjs). Web + Electron.
- Parameters:
  - Cache budgets: 50MB (documents), 15MB (lists/search)
  - TTLs: 7d (documents), 24h (lists/search), 10m (health memo)
  - Circuit breaker: open after 3 fails; half-open after 10s; backoff 1→2→4→8s (cap 30s); close after 2 successes
  - Replay: ≤ 25 ops/run; backoff on 429/5xx
  - Fuzzy threshold: default 0.45; clamp [0,1]; `?similarity=` override
- Server queue: Dual-mode flush (body ops + DB drain), SKIP LOCKED, idempotency, dead-letter

Constraints & Non‑Goals
- Do not use IndexedDB; cache only HTTP GET responses (Cache Storage).
- PostgreSQL is source of truth; writes use server queue with idempotency.
- No Yjs/collab features (Option B scope).
- Respect auth; never cache sensitive endpoints; clear caches on logout or tenant change.

Milestones

Phase 0 — Foundation (≈3 days)
- Scope (in)
  - Feature flags scaffolding and CI wiring.
  - Telemetry/log plumbing and initial dashboards.
  - E2E test harness with Service Worker support (Playwright configuration, mocks).
  - Shared offline libraries skeletons (network detector, circuit breaker, cache manager).
- Work Items (tickets)
  - OFF-P0-FE-001: Feature flag system scaffolding for `offline.circuitBreaker`, `offline.swCaching`, `offline.conflictUI`. Owner: FE. Est: 1d. Dep: none.
  - OFF-P0-BE-001: Telemetry/logging sink or endpoint plumbing (server logger/export), basic dashboards. Owner: BE. Est: 1d. Dep: none.
  - OFF-P0-BOTH-001: Playwright E2E harness with SW enabled; utilities to simulate offline/online and cache assertions. Owner: FE/BE. Est: 1d. Dep: none.
  - OFF-P0-FE-002: Shared libs scaffold: `lib/offline/network-detector.ts`, `lib/offline/circuit-breaker.ts`, `lib/offline/cache-manager.ts`. Owner: FE. Est: 1d. Dep: none.
- Acceptance Criteria
  - Flags are togglable per env; basic telemetry visible; E2E harness runs; shared libs compile and are importable.

Phase 1 — Connectivity Foundation (≈1 week)
- Scope (in)
  - Smart network layer: reachability, RTT, circuit breaker with configured thresholds.
  - UI indicator for connectivity (Good/Degraded/Offline) and queue stats (depth, last sync).
  - Telemetry for connectivity and breaker states.
- Scope (out)
  - Service Worker caching and write replay (Phase 2).
  - Conflict Resolution UI (Phase 3).
- Work Items (tickets; 1–3 day granularity)
  - OFF-P1-FE-001: Network service with reachability probe to `/api/health` (timeout 1–2s), rolling RTT, exponential backoff. Owner: FE. Est: 2d. Dep: none.
  - OFF-P1-FE-002: Circuit breaker (open after 3 fails; half-open after 10s; close after 2 successes; backoff 1→2→4→8s cap 30s). Owner: FE. Est: 2d. Dep: P1-FE-001.
  - OFF-P1-FE-003: Connectivity UI badge + queue stats component (integrate into navbar/status area). Owner: FE. Est: 1–2d. Dep: P1-FE-001/002.
  - OFF-P1-FE-004: Telemetry hooks (RTT, breaker state changes, probe outcomes). Owner: FE. Est: 1d. Dep: P1-FE-001/002.
  - OFF-P1-BE-001: Health endpoint hardening (ensure 200 JSON and fast path; optional HEAD support). Owner: BE. Est: 0.5d. Dep: none.
- APIs/Contracts
  - `/api/health`: GET (and optional HEAD); returns `{ ok: true, timestamp }`.
- Testing
  - Unit: backoff/RTT, breaker open/half-open/close transitions (mocks for fetch and timers).
  - Integration: health endpoint responds under load.
  - E2E (Playwright): simulate offline/online; verify UI states and breaker behavior.
- Telemetry
  - RTT (rolling avg), breaker state durations, probe success rate, queue depth/last sync time.
- Security/Privacy
  - No sensitive data in telemetry; no PII.
- Risks/Mitigations
  - Flapping networks: introduce minimum breaker-open time (10s) and jitter.
  - False positives on health: use short timeout and backoff; allow manual retry.
  - UX overload: keep indicator subtle with tooltip for details.
- Estimate & Staffing
  - Duration: ~1 week. FE: 1 dev (4–5d). BE: 0.5d.
- Acceptance Criteria
  - Circuit breaker functions as specified; RTT and quality surfaced; UI shows Good/Degraded/Offline; tests pass.

Phase 2 — Service Worker Caching + Write Replay (≈1.5–2 weeks)
- Scope (in)
  - SW to cache GETs for documents/notes/panels/search with TTL/LRU within budgets (50MB/15MB).
  - Write replay: enqueue POST/PUT/DELETE when offline/breaker open; Background Sync where available; “Sync Now” fallback.
  - UI progress for replay; dead-letter visibility and controls (requeue/discard via existing endpoints).
  - Auth-aware cache keys; cache clear on logout/tenant change.
- Scope (out)
  - Conflict Resolution UI (Phase 3).
- Work Items (tickets)
  - OFF-P2-FE-001: SW registration & versioned cache namespaces (docs-cache, lists-cache). Owner: FE. Est: 1d. Dep: P1.
  - OFF-P2-FE-002: Cache strategies (stale-while-revalidate) for allowlisted endpoints; TTL & LRU enforcement (50MB/15MB). Owner: FE. Est: 3d. Dep: P2-FE-001.
  - OFF-P2-FE-003: Write replay queue interceptor (enqueue when offline/breaker open); Background Sync + “Sync Now”. Owner: FE. Est: 3–4d. Dep: P1-FE-002.
  - OFF-P2-FE-004: Replay progress UI + error reporting; dead-letter controls (call existing requeue/discard APIs). Owner: FE. Est: 2d. Dep: P2-FE-003, P2-BE-001.
  - OFF-P2-FE-005: Auth-scoped cache keys; cache purge on logout/tenant switch. Owner: FE. Est: 1d. Dep: P2-FE-001.
  - OFF-P2-FE-006: Electron IPC integration for offline status/queue visibility in desktop UI. Owner: FE. Est: 1d. Dep: P1-FE-003.
  - OFF-P2-FE-007: Web PWA manifest + install prompt; basic icons and scope. Owner: FE. Est: 1d. Dep: P2-FE-001.
  - OFF-P2-BE-001: Optional: add lightweight `/api/offline-queue/status` (counts by status) for UI. Owner: BE. Est: 1d. Dep: none.
  - OFF-P2-BE-002: Dual-mode flush smoke tests (DB-drain path with SKIP LOCKED; processed-only deletes). Owner: BE. Est: 1d. Dep: none.
  - OFF-P2-BE-003: E2E test data seeding script for notes/panels/documents to support SW tests. Owner: BE. Est: 1d. Dep: none.
- APIs/Contracts
  - Allowlist (GET only): `/api/postgres-offline/documents/*`, `/api/postgres-offline/notes*`, `/api/postgres-offline/panels*`, `/api/search?*` (sanitized).
  - Existing: `/api/offline-queue/dead-letter/requeue`, `/api/offline-queue/dead-letter/discard`, `/api/postgres-offline/queue/flush` (body ops & drain_db mode).
- Testing
  - Unit: cache key derivation, TTL/LRU eviction, replay batch limits (≤25), backoff on 429/5xx.
  - E2E (Playwright + SW): open recent docs offline; verify cache hits; replay upon reconnect; validate dead-letter flows.
  - Manual: iOS/Safari PWA constraints; fallback “Sync Now”.
- Telemetry
  - Cache hits/misses, cache size & evictions, replay processed/failed/expired, retries, dead-letter counts.
- Security/Privacy
  - Never cache sensitive endpoints; scope caches by user/tenant; purge on logout.
- Risks/Mitigations
  - Background Sync unavailable: provide manual “Sync Now” and timed retry.
  - Cache bloat: enforce LRU and budgets; monitor eviction counts.
  - Auth leakage: embed auth scope in cache key; clear on scope change.
- Estimate & Staffing
  - Duration: ~1.5–2 weeks. FE: 1 dev (7–9d). BE: 1–2d.
- Acceptance Criteria
  - Recent docs open offline; replay succeeds with progress; dead-letter handled; cache within budget/TTL; tests pass.

Phase 3 — Conflict Resolution UI (≈1.5–2 weeks)
- Scope (in)
  - Handle 409 responses by surfacing a dialog; leverage `/api/versions/...` and `/api/versions/compare`.
  - Provide actions: Keep Mine, Use Latest, Merge (simple three‑way), Force Save with warning.
  - Telemetry for outcomes and repeat conflicts.
- Scope (out)
  - Advanced semantic merges beyond minimal first pass (can iterate later).
- Work Items (tickets)
  - OFF-P3-FE-001: Conflict detection integration (intercept 409; collect base/current versions). Owner: FE. Est: 2d. Dep: P2.
  - OFF-P3-FE-002: ConflictResolutionDialog UI (diff view, actions, confirmation for force). Owner: FE. Est: 3–4d. Dep: P3-FE-001.
  - OFF-P3-FE-003: Simple three‑way merge for ProseMirror JSON (fallback to textual diff if not feasible). Owner: FE. Est: 2–3d. Dep: P3-FE-001, P3-FE-005.
  - OFF-P3-FE-004: Wire “force” save (set `force: true` on version POST); post-merge save workflow. Owner: FE. Est: 1–2d. Dep: P3-FE-002.
  - OFF-P3-FE-005: Diff/Merge utility library for ProseMirror JSON (helpers, adapters). Owner: FE. Est: 1–2d. Dep: P3-FE-001.
  - OFF-P3-BE-001: Ensure `/api/versions/[noteId]/[panelId]` and `/api/versions/compare` cover required metadata (hashes). Owner: BE. Est: 1d. Dep: none.
- APIs/Contracts
  - Existing: `/api/versions/[noteId]/[panelId]` (GET/POST/DELETE), `/api/versions/compare` (POST).
  - Error handling: 409 for version mismatch/content drift; provide `current_version`, `current_hash`.
- Testing
  - Unit: conflict handlers, merge utility edge cases.
  - Integration: simulate divergent saves and 409 handling.
  - E2E (Playwright): end‑to‑end resolve flows (keep mine/theirs/merge/force) leading to successful save.
- Telemetry
  - Conflict occurrences, action choices (mine/theirs/merge/force), resolution success rate, repeat conflicts.
- Security/Privacy
  - Avoid logging sensitive content; log only metadata and action.
- Risks/Mitigations
  - Merge complexity: start with minimal merge + clear UX; allow force save with warning.
  - Large documents: degrade to “choose side” if diff too large.
  - User confusion: provide clear labels, previews, and confirmations.
- Estimate & Staffing
  - Duration: ~1.5–2 weeks. FE: 1 dev (8–10d). BE: 1d.
- Acceptance Criteria
  - 409 flows open conflict dialog; user can keep mine/theirs/merge/force; saves succeed; metrics recorded.

Global
- Feature Flags
  - `offline.circuitBreaker` (Phase 1), `offline.swCaching` (Phase 2), `offline.conflictUI` (Phase 3).
- Rollout
  - Environments: dev → staging → canary (10–20%) → full.
  - Success gates per phase: Phase 1 (breaker stability; RTT data present), Phase 2 (offline open success >95%; replay success >99% within 2 retries), Phase 3 (conflict resolution success >95%; force-save <10%).
  - Rollback: disable feature flag; revert to previous SW version (cache bust via new cache name); restore from backups.
- Definition of Done
  - Phase 1: All acceptance criteria met; unit/E2E tests green; telemetry dashboards show RTT and breaker.
  - Phase 2: Acceptance criteria met; Playwright SW tests green; cache budgets & TTLs enforced; observability in place.
  - Phase 3: Acceptance criteria met; conflict flows verified; merge/force paths audited; metrics in dashboards.
  - Global: Docs updated (README/offline guide); troubleshooting section; flags documented.

Acceptance Criteria (Summary)
- P1: Circuit breaker functions; RTT/quality surfaced; UI shows Good/Degraded/Offline; backoff works; tests pass.
- P2: Recent docs open offline; replay succeeds with progress; dead-letter handled; cache within budget/TTL.
- P3: 409 flows open conflict dialog; user can keep mine/theirs/merge/force; saves succeed post-resolution.

References
- Proposal file: `codex/proposal/Unified Offline Foundation/PROPOSAL.md`
- Existing APIs: `/api/health`, `/api/postgres-offline/...`, `/api/versions/...`, `/api/search`
- Queue semantics: dual-mode flush; SKIP LOCKED; dead-letter; idempotency
