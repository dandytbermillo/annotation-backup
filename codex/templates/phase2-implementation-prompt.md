Title: Implement Phase 2 — Service Worker Caching + Write Replay (Unified Offline Foundation, Option A)

- Read: codex/proposal/Unified Offline Foundation/IMPLEMENTATION_PLAN.md (Phase 2) and PROPOSAL.md
- Also read: CLAUDE.md → “Feature Workspace Structure (Required)” and follow it strictly for docs/reports/scripts placement

Constraints
- PostgreSQL-only; no IndexedDB/Yjs; cache only HTTP GETs (Cache Storage).
- Respect auth; never cache sensitive endpoints; clear caches on logout/tenant changes.
- Keep changes incremental and behind feature flags (Option A only).

Scope (Phase 2 only; assume Phases 0–1 complete)
- OFF-P2-FE-001: SW registration & versioned cache namespaces (docs-cache, lists-cache)
- OFF-P2-FE-002: Cache strategies (stale-while-revalidate) for allowlisted endpoints; TTL & LRU enforcement (50MB docs / 15MB lists)
- OFF-P2-FE-003: Write replay queue interceptor (enqueue when offline/breaker open); Background Sync + “Sync Now”
- OFF-P2-FE-004: Replay progress UI + error reporting; dead-letter controls (call existing requeue/discard APIs) [Dep: P2-FE-003, P2-BE-001]
- OFF-P2-FE-005: Auth-scoped cache keys; cache purge on logout/tenant switch
- OFF-P2-FE-006: Electron IPC integration for offline status/queue visibility in desktop UI
- OFF-P2-FE-007: Web PWA manifest + install prompt (icons/scope)
- OFF-P2-BE-001: Optional: `/api/offline-queue/status` (counts by status) for UI
- OFF-P2-BE-002: Dual-mode flush smoke tests (DB-drain path with SKIP LOCKED; processed-only deletes)
- OFF-P2-BE-003: E2E test data seeding script for notes/panels/documents (used by SW tests)

Feature Flags
- Use `offline.swCaching` (default OFF; enable in dev only after Phase 2 acceptance)
- Keep `offline.conflictUI` OFF; `offline.circuitBreaker` per Phase 1 acceptance

Implementation Notes
- Allowlist (GET only) for SW caching:
  - `/api/postgres-offline/documents/*`, `/api/postgres-offline/notes*`, `/api/postgres-offline/panels*`, `/api/search?*` (sanitized)
- Enforce budgets and TTLs:
  - Budgets: 50MB (documents), 15MB (lists/search)
  - TTLs: 7d (documents), 24h (lists/search)
- Write replay:
  - Batch limit ≤ 25 ops per run; backoff on 429/5xx; integrate Background Sync where supported; “Sync Now” fallback
- Auth-aware keys; clear caches on logout/tenant change; never cache sensitive endpoints

Workspace Structure (per CLAUDE.md)
- Place Phase 2 artifacts under:
  - `docs/proposal/unified_offline_foundation/reports/<date>-phase2-implementation-report.md`
  - `docs/proposal/unified_offline_foundation/test_scripts/` (Phase 2 verifiers)
  - `docs/proposal/unified_offline_foundation/supporting_files/` (if needed)
- Include clear run commands and expected outcomes in the report

Testing
- Unit: cache key derivation; TTL/LRU eviction paths; replay batch limit (≤25); backoff handling (429/5xx)
- Integration: `/api/offline-queue/status` (if implemented); dual-mode flush DB-drain behavior
- E2E (Playwright with SW): open recent docs offline (cache hit); replay upon reconnect (progress UI); dead-letter flows (requeue/discard)
- Manual: iOS/Safari PWA constraints; confirm “Sync Now” fallback works when Background Sync absent
- Use E2E data seeding script (OFF-P2-BE-003) for predictable test data

Verify (Phase 2 Acceptance)
- Recent documents open offline from SW cache
- Replay succeeds on reconnect with visible progress; backoff honored; ≤ 25 ops/run
- Dead-letter operations are visible and controllable via UI
- Cache budgets and TTLs enforced; no sensitive endpoints cached
- All Phase 2 tests (unit/integration/E2E) pass

Output (Phase 2)
- Summary of changes and file paths
- Flag default and rollout plan (dev → staging → canary → full; gates = offline open success >95%, replay success >99% within 2 retries)
- Test commands and results (unit/integration/E2E)
- Any deviations and rationale

